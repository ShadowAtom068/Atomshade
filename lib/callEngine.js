import { getIceServers } from './iceServers';

// The calling engine. It has no React inside it, so it is easy to test.
//
// How a call starts (the database has already rung the other person):
//   1. Both people join a private "room" for this call (a Supabase broadcast channel).
//   2. The person who ANSWERED keeps shouting "ready" until the caller hears it.
//   3. The caller then makes an offer; the answerer replies with an answer.
//   4. Both sides swap network addresses (ICE) until a direct path is found.
// Waiting for "ready" is what stops the offer from being lost when the other person has not
// joined yet (the old version had that bug).
//
// States: starting, ringing, connecting, connected, reconnecting, failed, ended,
//         declined, no-answer, error
export class CallSession {
  constructor({ role, media, send, onState, onRemoteStream, onLocalStream, onNotice, ringMs = 45000, iceServers, mediaDevices, PeerConnection }) {
    this.role = role; // 'caller' | 'callee'
    this.media = media; // 'audio' | 'video'
    this.send = send; // (payload) => void  — sends a message into the call room
    this.onState = onState || (() => {});
    this.onRemoteStream = onRemoteStream || (() => {});
    this.onLocalStream = onLocalStream || (() => {});
    this.onNotice = onNotice || (() => {});
    this.ringMs = ringMs;
    this.iceServers = iceServers || getIceServers();
    this.mediaDevices = mediaDevices || (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined);
    this.PC = PeerConnection || (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : undefined);
    this.state = 'starting';
    this.error = '';
    this.pc = null;
    this.local = null;
    this.remote = null;
    this.pendingIce = [];
    this.remoteSet = false;
    this.offered = false;
    this.disposed = false;
    this.readyTimer = null;
    this.ringTimer = null;
    this.disconnectTimer = null;
  }

  setState(state, error = '') {
    if (this.disposed) return;
    const terminal = ['ended', 'declined', 'no-answer', 'error', 'failed'];
    if (terminal.includes(this.state) && state !== this.state) return; // never leave a finished state
    this.state = state;
    this.error = error;
    this.onState(state, error);
  }

  static friendlyMediaError(e, media) {
    const name = e && e.name;
    const what = media === 'video' ? 'camera and microphone' : 'microphone';
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return 'Calls only work on a secure (https) address. Open the app from its https link.';
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') return `Please allow the ${what} for this site, then try again.`;
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what} was found on this device.`;
    if (name === 'NotReadableError') return `Your ${what} is being used by another app.`;
    return (e && e.message) || `Could not use your ${what}.`;
  }

  async getLocal() {
    if (this.local) return this.local;
    if (!this.mediaDevices || !this.mediaDevices.getUserMedia) {
      throw Object.assign(new Error('This browser cannot make calls.'), { name: 'NotSupportedError' });
    }
    let stream;
    if (this.media === 'video') {
      try {
        // Modest size keeps video smooth on phone data and hotspots.
        stream = await this.mediaDevices.getUserMedia({
          audio: true,
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
        });
      } catch (e) {
        // No camera (or it is busy / blocked): carry on as a voice call instead of failing.
        try {
          stream = await this.mediaDevices.getUserMedia({ audio: true });
          this.onNotice('Camera not available on this device, so this call is voice only.');
        } catch (e2) {
          throw e;
        }
      }
    } else {
      stream = await this.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    if (this.disposed) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('cancelled');
    }
    this.local = stream;
    this.onLocalStream(stream);
    return stream;
  }

  makePeer() {
    if (this.pc) return this.pc;
    if (!this.PC) throw new Error('This browser cannot make calls.');
    const pc = new this.PC({ iceServers: this.iceServers });
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ type: 'ice', candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
    };
    pc.ontrack = (e) => {
      if (!this.remote) this.remote = new MediaStream();
      const stream = e.streams && e.streams[0] ? e.streams[0] : this.remote;
      if (!(e.streams && e.streams[0])) stream.addTrack(e.track);
      this.onRemoteStream(stream);
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        clearTimeout(this.disconnectTimer);
        clearTimeout(this.ringTimer);
        this.setState('connected');
      } else if (s === 'disconnected') {
        this.setState('reconnecting');
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = setTimeout(() => {
          if (this.pc && this.pc.connectionState !== 'connected') this.setState('failed', 'The connection was lost.');
        }, 12000);
      } else if (s === 'failed') {
        this.setState('failed', 'Could not connect. Your networks may be blocking calls.');
      }
    };
    const tracks = this.local ? this.local.getTracks() : [];
    tracks.forEach((t) => pc.addTrack(t, this.local));
    // No camera here? Still receive the other person's video.
    if (this.media === 'video' && this.role === 'caller' && !tracks.some((t) => t.kind === 'video') && pc.addTransceiver) {
      pc.addTransceiver('video', { direction: 'recvonly' });
    }
    return pc;
  }

  // Call this once the call room is joined.
  async start() {
    try {
      await this.getLocal();
    } catch (e) {
      if (this.disposed) return;
      this.setState('error', CallSession.friendlyMediaError(e, this.media));
      return;
    }
    if (this.disposed) return;
    this.makePeer();
    if (this.role === 'callee') {
      this.setState('connecting');
      const shout = () => this.send({ type: 'ready' });
      shout();
      this.readyTimer = setInterval(shout, 1000);
      this.ringTimer = setTimeout(() => this.setState('failed', 'Could not connect. Please try again.'), 30000);
    } else {
      this.setState('ringing');
      this.ringTimer = setTimeout(() => this.setState('no-answer'), this.ringMs);
    }
  }

  async handle(msg) {
    if (this.disposed || !msg) return;
    if (['ended', 'declined', 'no-answer', 'error', 'failed'].includes(this.state)) return;
    try {
      if (msg.type === 'ready' && this.role === 'caller') {
        if (this.offered || !this.pc) return;
        this.offered = true;
        clearTimeout(this.ringTimer);
        this.setState('connecting');
        this.ringTimer = setTimeout(() => this.setState('failed', 'Could not connect. Please try again.'), 30000);
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.send({ type: 'offer', description: { type: offer.type, sdp: offer.sdp } });
      } else if (msg.type === 'offer' && this.role === 'callee') {
        if (this.remoteSet || !this.pc) return;
        clearInterval(this.readyTimer);
        await this.pc.setRemoteDescription(msg.description);
        this.remoteSet = true;
        await this.flushIce();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.send({ type: 'answer', description: { type: answer.type, sdp: answer.sdp } });
      } else if (msg.type === 'answer' && this.role === 'caller') {
        if (this.remoteSet || !this.pc) return;
        await this.pc.setRemoteDescription(msg.description);
        this.remoteSet = true;
        await this.flushIce();
      } else if (msg.type === 'ice' && msg.candidate) {
        if (this.remoteSet && this.pc) await this.pc.addIceCandidate(msg.candidate).catch(() => {});
        else this.pendingIce.push(msg.candidate); // too early: keep it until the offer/answer is in
      } else if (msg.type === 'hangup') {
        this.setState('ended');
      }
    } catch (e) {
      this.setState('error', (e && e.message) || 'Call connection error.');
    }
  }

  async flushIce() {
    const list = this.pendingIce;
    this.pendingIce = [];
    for (const c of list) {
      try {
        await this.pc.addIceCandidate(c);
      } catch (e) {
        /* a bad candidate is not fatal */
      }
    }
  }

  // The database told us how the call ended (declined, cancelled, ...).
  remoteEnded(kind) {
    this.setState(kind === 'declined' ? 'declined' : 'ended');
  }

  setMuted(muted) {
    if (this.local) this.local.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  setCameraOff(off) {
    if (this.local) this.local.getVideoTracks().forEach((t) => (t.enabled = !off));
  }

  hangup() {
    try {
      this.send({ type: 'hangup' });
    } catch (e) {
      /* ignore */
    }
    this.setState('ended');
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.readyTimer);
    clearTimeout(this.ringTimer);
    clearTimeout(this.disconnectTimer);
    try {
      if (this.pc) {
        this.pc.onicecandidate = null;
        this.pc.ontrack = null;
        this.pc.onconnectionstatechange = null;
        this.pc.close();
      }
    } catch (e) {
      /* ignore */
    }
    if (this.local) this.local.getTracks().forEach((t) => t.stop());
    this.pc = null;
    this.local = null;
  }
}
