'use client';

import { I } from './Icons';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Avatar from './Avatar';

// Inner Orbit: the few people who can see your private status updates.
export default function OrbitEditor({ me, people, onClose, onSaved }) {
  const [picked, setPicked] = useState(null); // Set of ids, null while loading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase
      .from('close_friends')
      .select('friend_id')
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        setPicked(new Set((data || []).map((r) => r.friend_id)));
      });
  }, []);

  function toggle(id) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('set_inner_orbit', { p_friends: Array.from(picked) });
    setBusy(false);
    if (err) {
      setError(err.code === 'PGRST202' ? 'Inner Orbit is not set up yet. Run update-shade-features.sql in Supabase.' : err.message);
      return;
    }
    onSaved && onSaved(picked.size);
    onClose();
  }

  const list = people.filter((p) => p.id !== me.id);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Inner Orbit</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><I n="close" /></button>
        </div>
        <p className="modal-sub">Only these people can see status updates you post to your Inner Orbit. Nobody is told who is in it.</p>
        {error && <div className="error">{error}</div>}
        <div className="chat-list">
          {picked === null && <div className="list-empty">Loading...</div>}
          {picked && list.length === 0 && <div className="list-empty">Start a chat with a friend first, then they will show up here.</div>}
          {picked &&
            list.map((p) => (
              <button key={p.id} type="button" className="chat-item" onClick={() => toggle(p.id)}>
                <Avatar name={p.name} seed={p.id} small />
                <div className="chat-meta"><div className="chat-name">{p.name}</div></div>
                <span className={`check ${picked.has(p.id) ? 'on' : ''}`}>{picked.has(p.id) ? '' : ''}</span>
              </button>
            ))}
        </div>
        <div className="modal-foot">
          <button className="btn-primary" onClick={save} disabled={busy || picked === null}>
            {busy ? 'Saving...' : `Save (${picked ? picked.size : 0} people)`}
          </button>
        </div>
      </div>
    </div>
  );
}
