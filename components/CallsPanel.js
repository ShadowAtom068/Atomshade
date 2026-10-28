'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatTime } from '../lib/format';
import Avatar from './Avatar';

function durationText(call) {
  if (!call.answered_at || !call.ended_at) return '';
  const sec = Math.max(0, Math.round((new Date(call.ended_at) - new Date(call.answered_at)) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

// The "Calls" tab: a history of calls you made and received. Tap the phone to call back.
export default function CallsPanel({ me, onCall, busy, refreshKey }) {
  const [calls, setCalls] = useState([]);
  const [names, setNames] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('calls')
      .select('id, caller_id, callee_id, media, status, created_at, answered_at, ended_at')
      .order('created_at', { ascending: false })
      .limit(60);
    setLoaded(true);
    if (loadError) {
      setError(
        loadError.code === '42P01' || loadError.code === 'PGRST205'
          ? 'Call history is not set up yet. Run update-v0.7.1-fixes.sql in Supabase.'
          : loadError.message
      );
      return;
    }
    setError('');
    setCalls(data || []);
    const ids = [...new Set((data || []).map((c) => (c.caller_id === me.id ? c.callee_id : c.caller_id)))];
    if (ids.length) {
      const { data: people } = await supabase.from('profiles').select('id, name').in('id', ids);
      setNames(Object.fromEntries((people || []).map((p) => [p.id, p.name])));
    }
  }, [me.id]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const ch = supabase
      .channel(`calls-history:${me.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [me.id, load]);

  if (error) return <div className="list-empty">{error}</div>;
  if (loaded && calls.length === 0) {
    return (
      <div className="list-empty">
        No calls yet.
        <br />
        Open a chat and tap ☎ to call a friend.
      </div>
    );
  }

  return (
    <div className="chat-list">
      {calls.map((c) => {
        const outgoing = c.caller_id === me.id;
        const otherId = outgoing ? c.callee_id : c.caller_id;
        const name = names[otherId] || 'Someone';
        const answered = !!c.answered_at;
        const missed = !outgoing && !answered && ['missed', 'cancelled', 'ringing'].includes(c.status);
        const declined = c.status === 'declined';
        let detail;
        if (answered) detail = `${outgoing ? 'Outgoing' : 'Incoming'} · ${durationText(c) || 'connected'}`;
        else if (missed) detail = 'Missed';
        else if (declined) detail = outgoing ? 'Declined' : 'You declined';
        else detail = outgoing ? 'No answer' : 'Missed';
        const arrow = outgoing ? '↗' : '↙';
        return (
          <div key={c.id} className="chat-item static">
            <Avatar name={name} seed={otherId} />
            <div className="chat-meta">
              <div className="chat-row">
                <span className="chat-name">{name}</span>
                <span className="chat-time">{formatTime(c.created_at)}</span>
              </div>
              <div className={`chat-preview call-line ${missed ? 'missed' : ''}`}>
                {arrow} {c.media === 'video' ? 'Video' : 'Voice'} · {detail}
              </div>
            </div>
            <button
              className="icon-btn"
              disabled={busy}
              title="Call back"
              aria-label={`Call ${name} back`}
              onClick={() => onCall({ other_id: otherId, title: name }, c.media)}
            >
              {c.media === 'video' ? '▣' : '☎'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
