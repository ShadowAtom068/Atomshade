'use client';

import { useState } from 'react';
import { supabase } from '../lib/supabase';
import Avatar from './Avatar';

export default function GroupInfo({ chat, members, me, onClose, onLeft, onRenamed }) {
  const [busy, setBusy] = useState(false);
  const isAdmin = members.some((m) => m.user_id === me.id && m.role === 'admin');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(chat.real_title || chat.title);

  async function saveName(e) {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2) return alert('Group name must be at least 2 characters.');
    setBusy(true);
    const { error } = await supabase.rpc('rename_group', { p_conv: chat.conversation_id, p_name: n });
    setBusy(false);
    if (error) return alert(error.code === 'PGRST202' ? 'This needs the latest database update (update-chat-options.sql).' : error.message);
    setEditing(false);
    onRenamed && onRenamed();
  }

  async function leave() {
    if (!confirm('Leave this group? You will stop receiving its messages.')) return;
    setBusy(true);
    const { error } = await supabase.rpc('leave_group', { conv: chat.conversation_id });
    setBusy(false);
    if (error) alert(error.message);
    else onLeft();
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{chat.title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="modal-sub">{members.length} members</p>
        {isAdmin && !editing && (
          <div className="pad-field">
            <button className="btn-ghost" onClick={() => setEditing(true)}>✏️ Rename group for everyone</button>
          </div>
        )}
        {isAdmin && editing && (
          <form className="pad-field" onSubmit={saveName}>
            <input autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" />
            <div className="row-gap" style={{ marginTop: 8 }}>
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy}>Save</button>
            </div>
          </form>
        )}
        <div className="chat-list">
          {members.map((m) => (
            <div key={m.user_id} className="chat-item static">
              <Avatar name={m.profiles?.name || '?'} seed={m.user_id} small />
              <div className="chat-meta">
                <div className="chat-name">
                  {m.profiles?.name || 'Member'}
                  {m.user_id === me.id ? ' (you)' : ''}
                </div>
                <div className="chat-preview">{m.role === 'admin' ? 'Group admin' : ''}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-foot">
          <button className="btn-danger" onClick={leave} disabled={busy}>
            {busy ? 'Leaving...' : 'Leave group'}
          </button>
        </div>
      </div>
    </div>
  );
}
