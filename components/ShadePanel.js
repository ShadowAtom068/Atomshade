'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatTime, clockTime } from '../lib/format';
import Avatar from './Avatar';

const NOT_SET_UP = 'Throw Shade is not set up yet. Run update-shade-features.sql in Supabase (see UPDATE-v0.7.1.md).';
const fail = (err) => (err?.code === 'PGRST202' ? NOT_SET_UP : err?.message || 'Something went wrong');

// Throw Shade: anonymous messages inside a group of 3 or more.
export default function ShadePanel({ me, groups, onUnread }) {
  const [threads, setThreads] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null); // thread row
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('my_shade_threads');
    if (err) {
      setError(fail(err));
    } else {
      setError('');
      const rows = Array.isArray(data) ? data : [];
      setThreads(rows);
      onUnread && onUnread(rows.filter((t) => t.unread).length);
    }
    setLoaded(true);
  }, [onUnread]);

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load]);

  if (open) {
    return (
      <ShadeThread
        thread={open}
        onBack={() => {
          setOpen(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="shade-panel">
      <div className="shade-hero">
        <strong>🕶 Throw Shade</strong>
        <p>
          Send an anonymous message to someone in a group. They never see who you are, and they can reply, close it, or
          block you from sending more. Messages that get reported are seen by Atomshade moderators, including who sent
          them.
        </p>
        <button className="btn-primary" onClick={() => setComposing(true)}>
          Throw shade
        </button>
      </div>

      {error && <div className="error" style={{ margin: 12 }}>{error}</div>}
      {loaded && !error && threads.length === 0 && <div className="list-empty">No shades yet. Quiet in here.</div>}

      <div className="chat-list">
        {threads.map((t) => (
          <button key={t.thread_id} className="chat-item" onClick={() => setOpen(t)}>
            <div className="avatar small group-avatar">{t.i_am === 'target' ? '🕶' : '➤'}</div>
            <div className="chat-meta">
              <div className="chat-row">
                <span className="chat-name">{t.i_am === 'target' ? 'Anonymous' : `To ${t.other_name || 'someone'}`}</span>
                <span className={`chat-time ${t.unread ? 'unread' : ''}`}>{formatTime(t.last_at)}</span>
              </div>
              <div className="chat-row">
                <span className="chat-preview">
                  {t.closed ? '🚫 Closed · ' : ''}
                  {t.last_mine ? 'You: ' : ''}
                  {t.last_body}
                </span>
                {t.unread && <span className="badge">●</span>}
              </div>
              <div className="chat-preview" style={{ fontSize: 11 }}>in {t.circle_name || 'a group'}</div>
            </div>
          </button>
        ))}
      </div>

      {composing && (
        <ThrowShade
          me={me}
          groups={groups}
          onClose={() => setComposing(false)}
          onSent={() => {
            setComposing(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function ThrowShade({ me, groups, onClose, onSent }) {
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [target, setTarget] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const eligible = groups.filter((g) => Number(g.member_count) >= 3);

  useEffect(() => {
    if (!group) return;
    supabase
      .from('conversation_members')
      .select('user_id, profiles(id, name)')
      .eq('conversation_id', group.conversation_id)
      .then(({ data }) => setMembers((data || []).filter((m) => m.user_id !== me.id && m.profiles)));
  }, [group, me.id]);

  async function send(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('send_shade', {
      p_circle: group.conversation_id,
      p_target: target.user_id,
      p_body: body.trim(),
    });
    setBusy(false);
    if (err) setError(fail(err));
    else onSent();
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={send}>
        <div className="modal-head">
          {(group || target) && (
            <button type="button" className="icon-btn" aria-label="Back" onClick={() => (target ? setTarget(null) : setGroup(null))}>
              ←
            </button>
          )}
          <h3>🕶 Throw shade</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {error && <div className="error">{error}</div>}

        {!group && (
          <div className="chat-list">
            <p className="modal-sub">Pick the group. Only groups with 3 or more people work, so nobody can guess who sent it.</p>
            {eligible.length === 0 && <div className="list-empty">You are not in a group with 3 or more people yet.</div>}
            {eligible.map((g) => (
              <button type="button" key={g.conversation_id} className="chat-item" onClick={() => setGroup(g)}>
                <Avatar name={g.title} seed={g.conversation_id} small />
                <div className="chat-meta"><div className="chat-name">{g.title}</div><div className="chat-preview">{g.member_count} people</div></div>
              </button>
            ))}
          </div>
        )}

        {group && !target && (
          <div className="chat-list">
            <p className="modal-sub">Who is this for, in {group.title}?</p>
            {members.map((m) => (
              <button type="button" key={m.user_id} className="chat-item" onClick={() => setTarget(m)}>
                <Avatar name={m.profiles.name} seed={m.user_id} small />
                <div className="chat-meta"><div className="chat-name">{m.profiles.name}</div></div>
              </button>
            ))}
          </div>
        )}

        {group && target && (
          <>
            <p className="modal-sub">
              To <b>{target.profiles.name}</b> in {group.title}. They will not see your name. Be kind: you can be reported, and
              moderators can see who sent a reported shade.
            </p>
            <div className="field">
              <textarea rows={4} maxLength={500} autoFocus placeholder="Say it..." value={body} onChange={(e) => setBody(e.target.value)} />
              <small className="hint">{body.length}/500</small>
            </div>
            <div className="modal-foot">
              <button className="btn-primary" disabled={busy || !body.trim()}>{busy ? 'Sending...' : 'Send anonymously'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

function ShadeThread({ thread, onBack }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(thread.closed);
  const [busy, setBusy] = useState(false);
  const bottom = useRef(null);
  const isTarget = thread.i_am === 'target';

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('shade_thread_messages', { p_thread: thread.thread_id });
    if (err) {
      setError(fail(err));
      return;
    }
    setMsgs(data || []);
    supabase.rpc('mark_shade_read', { p_thread: thread.thread_id }).then(() => {});
  }, [thread.thread_id]);

  useEffect(() => {
    load();
    const id = setInterval(load, 6000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs.length]);

  async function reply(e) {
    e.preventDefault();
    const b = text.trim();
    if (!b || busy) return;
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('reply_shade', { p_thread: thread.thread_id, p_body: b });
    setBusy(false);
    if (err) {
      setError(fail(err));
      if (/closed/i.test(err.message)) setClosed(true);
      return;
    }
    setText('');
    load();
  }

  async function close(block) {
    const ask = block
      ? 'Close this and stop this hidden person from sending you more shades?'
      : 'Close this shade? Nobody can reply any more.';
    if (!confirm(ask)) return;
    const { error: err } = await supabase.rpc('close_shade_thread', { p_thread: thread.thread_id, p_block: block });
    if (err) setError(fail(err));
    else setClosed(true);
  }

  async function report(m) {
    if (!confirm('Report this message to Atomshade moderators? They will be able to see who sent it. The sender is also blocked from you.')) return;
    const reason = prompt('What is wrong with it? (optional)') || '';
    const { error: err } = await supabase.rpc('report_shade', { p_thread: thread.thread_id, p_message: m.id, p_reason: reason.slice(0, 500) });
    if (err) setError(fail(err));
    else {
      setClosed(true);
      alert('Reported. Thank you. This shade is closed.');
    }
  }

  return (
    <div className="shade-thread">
      <div className="chat-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
        <div className="who">
          <div className="name">{isTarget ? '🕶 Anonymous' : `To ${thread.other_name || 'someone'}`}</div>
          <div className="status">in {thread.circle_name || 'a group'}</div>
        </div>
        {!closed && (
          <div className="call-head-actions">
            <button className="icon-btn" title="Close this shade" onClick={() => close(false)}>🚫</button>
          </div>
        )}
      </div>
      <div className="messages">
        {msgs.map((m) => (
          <div key={m.id} className={`bubble-row ${m.mine ? 'mine' : 'theirs'}`}>
            <div className="bubble">
              {!m.mine && <div className="sender-name">{m.hidden ? '🕶 Anonymous' : thread.other_name || 'Them'}</div>}
              {m.body}
              <div className="bubble-meta"><span>{clockTime(m.created_at)}</span></div>
              {isTarget && m.hidden && !closed && (
                <div className="message-actions always">
                  <button type="button" onClick={() => report(m)}>Report</button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {error && <div className="error" style={{ margin: '0 12px' }}>{error}</div>}
      {closed ? (
        <div className="closed-note">This shade is closed.</div>
      ) : (
        <>
          {isTarget && (
            <div className="shade-actions">
              <button type="button" className="link-btn" onClick={() => close(true)}>Close and block this sender</button>
            </div>
          )}
          <form className="composer" onSubmit={reply}>
            <input placeholder="Reply" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
            <button className="send-btn" aria-label="Send" disabled={!text.trim() || busy}>➤</button>
          </form>
        </>
      )}
    </div>
  );
}
