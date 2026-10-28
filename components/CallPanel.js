'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { CallSession } from '../lib/callEngine';
import { hasTurn } from '../lib/iceServers';

const TERMINAL = ['ended', 'declined', 'no-answer', 'error', 'failed'];

const LABELS = {
  starting: 'Starting…',
  ringing: 'Calling…',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  failed: 'Call failed',
  ended: 'Call ended',
  declined: 'Call declined',
  'no-answer': 'No answer',
  error: 'Call problem',
};

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// One-to-one call window. The database (the `calls` table) already rang the other person;
// this window only handles the live audio/video.
//   role: 'caller' (you started it) or 'callee' (you answered)
export default function CallPanel({ me, peer, role, media, callId, onClose }) {
  const [state, setState] = useState('starting');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState('');
  const session = useRef(null);
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const remoteAudio = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const reported = useRef(false);
  const pendingLeave = useRef(null); // see the cleanup below

  function attach(el, stream) {
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
      const p = el.play && el.play();
      if (p && p.catch) p.catch(() => {});
    }
  }

  // Tell the database how the call ended (only once).
  async function report(action) {
    if (reported.current) return;
    reported.current = true;
    try {
      await supabase.rpc('update_call', { p_call: callId, p_action: action });
    } catch (e) {
      /* the other side will time out on its own */
    }
  }

  useEffect(() => {
    // React (in development) mounts, throws away and re-mounts a screen once. That throw-away
    // must NOT hang up the call, so a real "leave" is delayed a moment and cancelled if we re-mount.
    if (pendingLeave.current) {
      clearTimeout(pendingLeave.current.timer);
      pendingLeave.current.quiet();
      pendingLeave.current = null;
    }
    let alive = true;
    const room = supabase.channel(`call-room:${callId}`, { config: { broadcast: { self: false } } });
    const dbWatch = supabase.channel(`call-row:${callId}:${me.id}`);

    const s = new CallSession({
      role,
      media,
      send: (payload) => {
        room.send({ type: 'broadcast', event: 'signal', payload: { ...payload, from: me.id } });
      },
      onState: (st, err) => {
        if (!alive) return;
        setState(st);
        setError(err || '');
        if (st === 'no-answer' && role === 'caller') report('missed');
        else if (TERMINAL.includes(st) && st !== 'declined') report('end');
      },
      onRemoteStream: (stream) => {
        remoteStreamRef.current = stream;
        attach(media === 'video' ? remoteVideo.current : remoteAudio.current, stream);
      },
      onNotice: (t) => alive && setNotice(t),
      onLocalStream: (stream) => {
        localStreamRef.current = stream;
        attach(localVideo.current, stream);
      },
    });
    session.current = s;

    room.on('broadcast', { event: 'signal' }, ({ payload }) => {
      if (!payload || payload.from === me.id) return;
      s.handle(payload);
    });

    // The database tells us if the other person declined or the caller cancelled.
    function onRow(row) {
      if (!row) return;
      if (row.status === 'declined') s.remoteEnded('declined');
      else if (row.status === 'cancelled' || row.status === 'missed' || row.status === 'ended') {
        reported.current = true; // already recorded
        s.remoteEnded('ended');
      }
    }
    dbWatch.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}` },
      (p) => onRow(p.new)
    );

    let roomReady = false;
    let watchReady = false;
    const go = async () => {
      if (!alive || !roomReady || !watchReady) return;
      // Catch anything that happened before we were listening.
      const { data } = await supabase.from('calls').select('status').eq('id', callId).maybeSingle();
      if (!alive) return;
      if (data && data.status === 'declined') {
        s.remoteEnded('declined');
        return;
      }
      if (data && ['cancelled', 'missed', 'ended'].includes(data.status)) {
        reported.current = true;
        s.remoteEnded('ended');
        return;
      }
      s.start();
    };
    room.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        roomReady = true;
        go();
      } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && alive) {
        setState('error');
        setError('Could not reach the call server. Check your internet and try again.');
      }
    });
    dbWatch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        watchReady = true;
        go();
      }
    });

    return () => {
      alive = false;
      const quiet = () => {
        s.dispose();
        supabase.removeChannel(room);
        supabase.removeChannel(dbWatch);
      };
      const leave = () => {
        pendingLeave.current = null;
        // Leaving the window while the call is live means hanging up.
        if (!TERMINAL.includes(s.state)) {
          s.hangup();
          report('end');
        }
        quiet();
      };
      pendingLeave.current = { quiet, timer: setTimeout(leave, 150) };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  // The call timer
  useEffect(() => {
    if (state !== 'connected') return undefined;
    const t0 = Date.now() - seconds * 1000;
    const id = setInterval(() => setSeconds(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Close by itself shortly after the call is over.
  useEffect(() => {
    if (!TERMINAL.includes(state)) return undefined;
    const id = setTimeout(onClose, state === 'ended' ? 1200 : 3500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Video elements appear after the first render: attach streams again once they exist.
  useEffect(() => {
    attach(localVideo.current, localStreamRef.current);
    attach(remoteVideo.current, remoteStreamRef.current);
    attach(remoteAudio.current, remoteStreamRef.current);
  });

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    session.current && session.current.setMuted(next);
  }
  function toggleCamera() {
    const next = !cameraOff;
    setCameraOff(next);
    session.current && session.current.setCameraOff(next);
  }
  function hangup() {
    if (TERMINAL.includes(state)) {
      onClose();
      return;
    }
    session.current && session.current.hangup();
  }

  const finished = TERMINAL.includes(state);
  const title = peer.name || 'Call';
  const subtitle = state === 'connected' ? fmt(seconds) : LABELS[state] || '';

  return (
    <div className="call-backdrop" role="dialog" aria-modal="true" aria-label="Call">
      <section className="call-card">
        <div className="call-card-head">
          <div>
            <span className="call-eyebrow">ATOMSHADE {media === 'video' ? 'VIDEO' : 'VOICE'} CALL</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-btn" onClick={hangup} aria-label="End call">
            ✕
          </button>
        </div>

        {media === 'video' ? (
          <div className="call-videos">
            <video ref={remoteVideo} autoPlay playsInline />
            <video ref={localVideo} autoPlay playsInline muted />
          </div>
        ) : (
          <div className="call-audio-stage">
            <div className="call-avatar">{(title || '?').slice(0, 1).toUpperCase()}</div>
            <span>{state === 'connected' ? 'On the call' : LABELS[state]}</span>
            <audio ref={remoteAudio} autoPlay />
          </div>
        )}

        {error && <p className="call-error">{error}</p>}
        {notice && !error && <p className="call-notice">{notice}</p>}

        {!finished && (
          <div className="call-actions">
            <button onClick={toggleMute}>{muted ? '🔇 Unmute' : '🎙️ Mute'}</button>
            {media === 'video' && <button onClick={toggleCamera}>{cameraOff ? '📷 Camera on' : '🚫 Camera off'}</button>}
            <button className="call-end" onClick={hangup}>
              ☎ End call
            </button>
          </div>
        )}

        {state === 'failed' && hasTurn() && (
          <small className="call-note">
            The connection could not be made on this network. Check both phones are online, then try again.
          </small>
        )}
      </section>
    </div>
  );
}
