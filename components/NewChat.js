'use client';

import { I } from './Icons';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Avatar from './Avatar';
import { vibeOf } from '../lib/vibes';

const GroupIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="M16 5.2a3.2 3.2 0 0 1 0 6M18 14.4c1.8.8 3 2.6 3 5.6" />
  </svg>
);

export default function NewChat({ me, online, recent = [], onPickPerson, onCreateGroup, onClose }) {
  const [people, setPeople] = useState([]);
  const [secret, setSecret] = useState(false);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('chat'); // 'chat' = pick one person, 'group' = build a group
  const [picked, setPicked] = useState(new Set());
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  // Search runs on the server and only returns people who match what you typed:
  // part of a name (2+ letters), or a COMPLETE email or phone number.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setPeople([]);
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data, error: err } = await supabase.rpc('search_people', { p_query: term });
      if (cancelled) return;
      setLoading(false);
      if (err) {
        setError(err.code === 'PGRST202' ? 'Search is not set up yet. Run update-security.sql in Supabase.' : err.message);
        setPeople([]);
      } else {
        setError('');
        setPeople(data || []);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const searching = q.trim().length >= 2;
  const shown = searching
    ? people
    : recent.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()));

  function toggle(id) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    setBusy(true);
    await onCreateGroup(groupName.trim(), Array.from(picked));
    setBusy(false);
  }

  const canCreate = groupName.trim().length >= 2 && picked.size >= 1 && !busy;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          {mode === 'group' ? (
            <button className="icon-btn" onClick={() => setMode('chat')} aria-label="Back">
              <I n="back" />
            </button>
          ) : null}
          <h3>{mode === 'group' ? 'New group' : 'New chat'}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <I n="close" />
          </button>
        </div>

        {mode === 'group' && (
          <div className="search">
            <input
              placeholder="Group name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              maxLength={40}
              autoFocus
            />
          </div>
        )}

        <div className="search">
          <input placeholder="Search by name, or type a full phone number / email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="chat-list">
          {mode === 'chat' && (
            <button className="chat-item" onClick={() => setMode('group')}>
              <div className="avatar small group-avatar">
                <GroupIcon />
              </div>
              <div className="chat-meta">
                <div className="chat-name">New group</div>
                <div className="chat-preview">Chat with several people at once</div>
              </div>
            </button>
          )}

          {mode === 'chat' && (
            <label className="secret-toggle">
              <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
              <span><I n="lock" /> Secret chat <small>(end-to-end encrypted, text only)</small></span>
            </label>
          )}
          {!searching && shown.length > 0 && <div className="list-label">Your people</div>}
          {loading && <div className="list-empty">Searching...</div>}
          {error && <div className="error" style={{ margin: 12 }}>{error}</div>}
          {!loading && !error && shown.length === 0 && (
            <div className="list-empty">
              {searching
                ? 'No one found. Check the spelling, or type their full phone number or email.'
                : 'Type a name to find a friend. To find someone by phone or email, type the whole thing.'}
            </div>
          )}

          {shown.map((p) => (
            <button
              key={p.id}
              className="chat-item"
              onClick={() => (mode === 'group' ? toggle(p.id) : onPickPerson(p, secret))}
            >
              <Avatar name={p.name} seed={p.id} online={online.has(p.id)} small />
              <div className="chat-meta">
                <div className="chat-name">{p.name}</div>
                <div className="chat-preview">{vibeOf(p.vibe, p.vibe_until) ? `${vibeOf(p.vibe, p.vibe_until).icon} ${vibeOf(p.vibe, p.vibe_until).label}` : p.about || ''}</div>
              </div>
              {mode === 'group' && <span className={`check ${picked.has(p.id) ? 'on' : ''}`}>{picked.has(p.id) ? '' : ''}</span>}
            </button>
          ))}
        </div>

        {mode === 'group' && (
          <div className="modal-foot">
            <button className="btn-primary" onClick={create} disabled={!canCreate}>
              {busy ? 'Creating...' : picked.size ? `Create group (${picked.size} selected)` : 'Pick at least one person'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
