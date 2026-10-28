'use client';

import { I } from './Icons';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { GroupCallSession, MAX_CALL_PEOPLE } from '../lib/groupCall';

const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

function Tile({ name, stream, state, self, video, muted }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
      const p = el.play && el.play();
      if (p && p.catch) p.catch(() => {});
    }
  });
  const label = self ? 'You' : name;
  const status = !stream && !self ? (state === 'failed' ? 'Could not connect' : 'Connecting…') : state === 'reconnecting' ? 'Reconnecting…' : '';
  return (
    <div className={`gc-tile ${video && stream ? 'has-video' : ''}`} data-self={self ? '1' : undefined}>
      {video ? <video ref={ref} autoPlay playsInline muted={!!self} /> : !self && <audio ref={ref} autoPlay />}
      {(!video || !stream) && <div className="gc-avatar" aria-hidden="true">{(label || '?').slice(0, 1).toUpperCase()}</div>}
      <div className="gc-name">{label}{muted ? ' ' : ''}{status ? ` · ${status}` : ''}</div>
    </div>
  );
}

// Group call window: up to 4 people, everyone connected to everyone.
export default function GroupCallPanel({ me, call, onClose }) {
  const { id: callId, media, conversation_id: convId, title } = call;
  const [phase, setPhase] = useState('starting'); // starting | live | ended | error
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [present, setPresent] = useState([]);
  const [peers, setPeers] = useState([]);
  const [names, setNames] = useState({});
  const [seconds, setSeconds] = useState(0);
  const [local, setLocal] = useState(null);
  const session = useRef(null);
  const pendingLeave = useRef(null);
  const left = useRef(false);

  useEffect(() => {
    supabase
      .from('conversation_members')
      .select('user_id, profiles(id, name)')
      .eq('conversation_id', convId)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach((m) => {
          if (m.profiles) map[m.user_id] = m.profiles.name;
        });
        setNames(map);
      });
  }, [convId]);

  useEffect(() => {
    // React (in development) mounts, throws away and re-mounts once. That must not end the call.
    if (pendingLeave.current) {
      clearTimeout(pendingLeave.current.timer);
      pendingLeave.current.quiet();
      pendingLeave.current = null;
    }
    left.current = false;
    let alive = true;
    const room = supabase.channel(`gcall:${callId}`, { config: { broadcast: { self: false }, presence: { key: me.id } } });
    const s = new GroupCallSession({
      meId: me.id,
      media,
      send: (payload) => room.send({ type: 'broadcast', event: 'sig', payload }),
      onPeers: (list) => alive && setPeers(list),
      onLocalStream: (st) => alive && setLocal(st),
      onNotice: (t) => alive && setNotice(t),
    });
    session.current = s;
    room.on('broadcast', { event: 'sig' }, ({ payload }) => s.handle(payload));
    room.on('presence', { event: 'sync' }, () => {
      const ids = Object.keys(room.presenceState());
      if (!alive) return;
      setPresent(ids);
      s.setPeers(ids);
    });

    let ping = null;
    (async () => {
      const { error: jErr } = await supabase.rpc('join_group_call', { p_call: callId });
      if (!alive) return;
      if (jErr) {
        setPhase('error');
        setError(jErr.message);
        return;
      }
      try {
        await s.getLocal();
      } catch (e) {
        if (!alive) return;
        setPhase('error');
        setError(e.message || 'Could not use the microphone.');
        supabase.rpc('leave_group_call', { p_call: callId }).then(() => {});
        return;
      }
      if (!alive) return;
      room.subscribe(async (status) => {
        if (!alive) return;
        if (status === 'SUBSCRIBED') {
          await room.track({ user: me.id });
          if (alive) setPhase('live');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setPhase('error');
          setError('Could not reach the call server. Check your internet and try again.');
        }
      });
      ping = setInterval(async () => {
        const { data, error: pErr } = await supabase.rpc('ping_group_call', { p_call: callId });
        if (alive && !pErr && data === false) setPhase('ended');
      }, 15000);
    })();

    return () => {
      alive = false;
      clearInterval(ping);
      const quiet = () => {
        s.dispose();
        supabase.removeChannel(room);
      };
      const leave = () => {
        pendingLeave.current = null;
        if (!left.current) {
          left.current = true;
          supabase.rpc('leave_group_call', { p_call: callId }).then(() => {});
        }
        quiet();
      };
      pendingLeave.current = { quiet, timer: setTimeout(leave, 150) };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  useEffect(() => {
    if (phase !== 'live') return undefined;
    const t0 = Date.now() - seconds * 1000;
    const id = setInterval(() => setSeconds(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== 'ended' && phase !== 'error') return undefined;
    const id = setTimeout(onClose, phase === 'ended' ? 1500 : 4000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

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
    if (!left.current) {
      left.current = true;
      supabase.rpc('leave_group_call', { p_call: callId }).then(() => {});
    }
    onClose();
  }

  const video = media === 'video';
  const others = present.filter((id) => id !== me.id).slice(0, MAX_CALL_PEOPLE - 1);
  const byId = Object.fromEntries(peers.map((p) => [p.id, p]));
  const subtitle = phase === 'live' ? `${fmt(seconds)} · ${others.length + 1} in the call` : phase === 'starting' ? 'Joining…' : phase === 'ended' ? 'Call ended' : 'Call problem';

  return (
    <div className="call-backdrop" role="dialog" aria-modal="true" aria-label="Group call">
      <section className="call-card gc-card">
        <div className="call-card-head">
          <div>
            <span className="call-eyebrow">GROUP {video ? 'VIDEO' : 'VOICE'} CALL</span>
            <h2>{title || 'Group call'}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-btn" onClick={hangup} aria-label="Leave call"><I n="close" /></button>
        </div>

        <div className={`gc-grid n${Math.min(4, others.length + 1)}`}>
          <Tile self name="You" stream={local} video={video && !cameraOff} muted={muted} />
          {others.map((id) => (
            <Tile key={id} name={names[id] || 'Someone'} stream={byId[id]?.stream} state={byId[id]?.state || 'connecting'} video={video} />
          ))}
        </div>
        {phase === 'live' && others.length === 0 && <p className="call-notice">Waiting for others to join…</p>}
        {error && <p className="call-error" role="alert">{error}</p>}
        {notice && !error && <p className="call-notice">{notice}</p>}

        {(phase === 'live' || phase === 'starting') && (
          <div className="call-actions">
            <button onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
            {video && <button onClick={toggleCamera}>{cameraOff ? 'Camera on' : 'Camera off'}</button>}
            <button className="call-end" onClick={hangup}><I n="phone" /> Leave</button>
          </div>
        )}
        <small className="call-note">Up to {MAX_CALL_PEOPLE} people can be in one group call.</small>
      </section>
    </div>
  );
}
