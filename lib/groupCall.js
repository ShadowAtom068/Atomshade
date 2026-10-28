import { getIceServers } from './iceServers';
import { CallSession } from './callEngine';

export const MAX_CALL_PEOPLE = 4;

// The group-call engine (no React inside, so it can be tested).
// Everyone who is in the call talks directly to everyone else (a "mesh"), which is why 4 people is the limit:
// each phone sends its camera to 3 others. Messages travel through a private broadcast channel for this call.
//
// For every pair of people, the one whose id sorts first makes the offer; the other one answers.
// People are told about each other through the channel's presence list (setPeers).
export class GroupCallSession {
  constructor({ meId, media, send, onPeers, onLocalStream, onNotice, iceServers, mediaDevices, PeerConnection }) {
    this.meId = meId;
    this.media = media;
    this.send = send; // (payload) => void, goes to everybody in the call room
    this.onPeers = onPeers || (() => {});
    this.onLocalStream = onLocalStream || (() => {});
    this.onNotice = onNotice || (() => {});
    this.iceServers = iceServers || getIceServers();
    this.mediaDevices = mediaDevices || (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined);
    this.PC = PeerConnection || (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : undefined);
    this.local = null;
    this.peers = new Map(); // userId -> { pc, stream, state, pendingIce, remoteSet }
    this.disposed = false;
  }

  // Same camera/microphone logic as a normal call (falls back to voice if there is no camera).
  async getLocal() {
    if (this.local) return this.local;
    const helper = new CallSession({ role: 'caller', media: this.media, send: () => {}, mediaDevices: this.mediaDevices, onNotice: this.onNotice, onLocalStream: () => {} });
    try {
      this.local = await helper.getLocal();
    } catch (e) {
      throw Object.assign(new Error(CallSession.friendlyMediaError(e, this.media)), { name: e && e.name });
    }
    if (this.disposed) {
      this.local.getTracks().forEach((t) => t.stop());
      throw new Error('cancelled');
    }
    this.onLocalStream(this.local);
    return this.local;
  }

  emit() {
    if (this.disposed) return;
    this.onPeers([...this.peers.entries()].map(([id, p]) => ({ id, stream: p.stream, state: p.state })));
  }

  makePeer(id) {
    if (this.peers.has(id)) return this.peers.get(id);
    if (!this.PC) throw new Error('This browser cannot make calls.');
    const pc = new this.PC({ iceServers: this.iceServers });
    const peer = { pc, stream: null, state: 'connecting', pendingIce: [], remoteSet: false, timer: null };
    this.peers.set(id, peer);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ to: id, from: this.meId, type: 'ice', candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
    };
    pc.ontrack = (e) => {
      peer.stream = e.streams && e.streams[0] ? e.streams[0] : peer.stream || new MediaStream([e.track]);
      this.emit();
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        clearTimeout(peer.timer);
        peer.state = 'connected';
      } else if (s === 'disconnected') {
        peer.state = 'reconnecting';
        clearTimeout(peer.timer);
        peer.timer = setTimeout(() => {
          if (pc.connectionState !== 'connected') {
            peer.state = 'failed';
            this.emit();
          }
        }, 12000);
      } else if (s === 'failed') {
        peer.state = 'failed';
      }
      this.emit();
    };
    // Give up if nothing connects within 30 seconds.
    peer.timer = setTimeout(() => {
      if (pc.connectionState !== 'connected' && peer.state === 'connecting') {
        peer.state = 'failed';
        this.emit();
      }
    }, 30000);
    (this.local ? this.local.getTracks() : []).forEach((t) => pc.addTrack(t, this.local));
    // No camera here? Still receive the others' video.
    if (this.media === 'video' && this.local && !this.local.getVideoTracks().length && pc.addTransceiver) pc.addTransceiver('video', { direction: 'recvonly' });
    this.emit();
    return peer;
  }

  closePeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    try {
      p.pc.onicecandidate = null;
      p.pc.ontrack = null;
      p.pc.onconnectionstatechange = null;
      p.pc.close();
    } catch (e) {
      /* ignore */
    }
    this.peers.delete(id);
    this.emit();
  }

  // The list of people currently in the room (from the channel's presence). Includes me.
  async setPeers(ids) {
    if (this.disposed) return;
    const others = ids.filter((id) => id !== this.meId);
    for (const id of [...this.peers.keys()]) if (!others.includes(id)) this.closePeer(id);
    for (const id of others) {
      if (this.peers.has(id)) continue;
      if (this.peers.size >= MAX_CALL_PEOPLE - 1) continue; // the room is full
      const peer = this.makePeer(id);
      if (this.meId < id) {
        try {
          const offer = await peer.pc.createOffer();
          await peer.pc.setLocalDescription(offer);
          this.send({ to: id, from: this.meId, type: 'offer', description: { type: offer.type, sdp: offer.sdp } });
        } catch (e) {
          peer.state = 'failed';
          this.emit();
        }
      }
    }
  }

  async handle(msg) {
    if (this.disposed || !msg || msg.to !== this.meId || !msg.from || msg.from === this.meId) return;
    try {
      if (msg.type === 'offer') {
        if (!this.peers.has(msg.from) && this.peers.size >= MAX_CALL_PEOPLE - 1) return;
        // A fresh offer from someone we already have means they rejoined: start over with them.
        const existing = this.peers.get(msg.from);
        if (existing && existing.remoteSet) this.closePeer(msg.from);
        const peer = this.makePeer(msg.from);
        await peer.pc.setRemoteDescription(msg.description);
        peer.remoteSet = true;
        await this.flushIce(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.send({ to: msg.from, from: this.meId, type: 'answer', description: { type: answer.type, sdp: answer.sdp } });
      } else if (msg.type === 'answer') {
        const peer = this.peers.get(msg.from);
        if (!peer || peer.remoteSet) return;
        await peer.pc.setRemoteDescription(msg.description);
        peer.remoteSet = true;
        await this.flushIce(peer);
      } else if (msg.type === 'ice' && msg.candidate) {
        const peer = this.peers.get(msg.from);
        if (!peer) return;
        if (peer.remoteSet) await peer.pc.addIceCandidate(msg.candidate).catch(() => {});
        else peer.pendingIce.push(msg.candidate);
      }
    } catch (e) {
      const peer = this.peers.get(msg.from);
      if (peer) {
        peer.state = 'failed';
        this.emit();
      }
    }
  }

  async flushIce(peer) {
    const list = peer.pendingIce;
    peer.pendingIce = [];
    for (const c of list) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  setMuted(muted) {
    if (this.local) this.local.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  setCameraOff(off) {
    if (this.local) this.local.getVideoTracks().forEach((t) => (t.enabled = !off));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of [...this.peers.keys()]) {
      const p = this.peers.get(id);
      clearTimeout(p.timer);
      try {
        p.pc.onicecandidate = null;
        p.pc.ontrack = null;
        p.pc.onconnectionstatechange = null;
        p.pc.close();
      } catch (e) {
        /* ignore */
      }
    }
    this.peers.clear();
    if (this.local) this.local.getTracks().forEach((t) => t.stop());
    this.local = null;
  }
}
