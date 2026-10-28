'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatTime } from '../lib/format';

// Messages you starred (normal chats only; secret chats are never starred).
export default function StarredPanel({ me, onOpen, onClose }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let off = false;
    supabase.rpc('my_starred').then(({ data, error: e }) => {
      if (off) return;
      if (e) {
        setError(e.code === 'PGRST202' ? 'Starred messages need the latest database update (update-settings.sql).' : e.message);
        setItems([]);
      } else setItems(Array.isArray(data) ? data : []);
    });
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => {
      off = true;
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  async function unstar(it) {
    const { error: e } = await supabase.from('starred_messages').delete().eq('message_id', it.message_id);
    if (e) {
      setError(e.message.includes('permission') || e.code === '42501' ? 'Un-starring needs update-settings-delete.sql in Supabase (see UPDATE-v0.7.1.md).' : e.message);
      return;
    }
    setItems((list) => (list || []).filter((x) => x.message_id !== it.message_id));
  }

  const what = (it) => (it.kind === 'image' ? '📷 Photo' : it.kind === 'video' ? '🎥 Video' : it.kind === 'audio' ? '🎤 Voice note' : it.body || '');

  return (
    <div className="modal-bg" style={{ zIndex: 65 }} onClick={onClose}>
      <div className="modal starred" role="dialog" aria-modal="true" aria-label="Starred messages" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⭐ Starred messages</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="starred-body">
          {error && <div className="error" role="alert">{error}</div>}
          {items === null ? (
            <p className="list-empty">Loading…</p>
          ) : items.length === 0 ? (
            <p className="list-empty">No starred messages yet. Tap “Star” under a message to save it here.</p>
          ) : (
            <ul className="starred-list">
              {items.map((it) => (
                <li key={it.message_id}>
                  <button type="button" className="starred-item" onClick={() => onOpen(it.conversation_id)}>
                    <span className="starred-top">
                      <b>{it.sender_id === me.id ? 'You' : it.sender_name || 'Someone'}</b>
                      <small>{it.chat_title || 'Chat'} · {formatTime(it.sent_at)}</small>
                    </span>
                    <span className="starred-text">{what(it)}</span>
                  </button>
                  <button type="button" className="icon-btn" onClick={() => unstar(it)} aria-label="Remove star" title="Remove star">✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
