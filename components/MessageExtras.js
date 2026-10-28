'use client';

import { I, IconFile, IconImage, IconLocation, IconOnce, IconPoll } from './Icons';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { downloadUrl, mediaUrl } from '../lib/media';
import { REACTION_EMOJI, docIcon, formatBytes, googleLink, osmLink } from '../lib/extras';

// ----- Document bubble -----
export function FileMessage({ path, meta }) {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    try {
      const url = await downloadUrl(path, meta.name);
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      a.click();
    } catch (e) {
      alert('Could not open this document. It may have been removed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="file-msg" onClick={open} disabled={busy} aria-label={`Download ${meta.name}`}>
      <span className="file-icon" aria-hidden="true">{docIcon(meta.name)}</span>
      <span className="file-info">
        <span className="file-name">{meta.name}</span>
        <span className="file-size">{formatBytes(meta.size)} · {busy ? 'Opening…' : 'Tap to download'}</span>
      </span>
    </button>
  );
}

// ----- Location bubble (links to a map; no map is embedded, so nothing is sent to a map company until you tap) -----
export function LocationMessage({ meta }) {
  const lat = Number(meta.lat);
  const lng = Number(meta.lng);
  return (
    <div className="loc-msg">
      <div className="loc-pin" aria-hidden="true"><I n="location" /></div>
      <div className="loc-info">
        <strong>Location</strong>
        <span>{lat.toFixed(5)}, {lng.toFixed(5)}</span>
        <span className="loc-links">
          <a href={osmLink(lat, lng)} target="_blank" rel="noopener noreferrer">OpenStreetMap</a>
          <a href={googleLink(lat, lng)} target="_blank" rel="noopener noreferrer">Google Maps</a>
        </span>
      </div>
    </div>
  );
}

// ----- Poll bubble -----
export function PollMessage({ m, votes, meId, onVote, names }) {
  const options = Array.isArray(m.meta?.options) ? m.meta.options : [];
  const multi = !!m.meta?.multi;
  const mine = (votes && votes[meId]) || [];
  const counts = options.map((_, i) => Object.values(votes || {}).filter((c) => c.includes(i)).length);
  const voters = Object.values(votes || {}).filter((c) => c.length).length;
  const [open, setOpen] = useState(false);

  function pick(i) {
    let next;
    if (multi) next = mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i];
    else next = mine.includes(i) ? [] : [i];
    onVote(m.id, next);
  }
  return (
    <div className="poll-msg">
      <div className="poll-q"><I n="poll" /> {m.meta.q}</div>
      <div className="poll-hint">{multi ? 'Select one or more' : 'Select one'}</div>
      {options.map((o, i) => {
        const pct = voters ? Math.round((counts[i] / voters) * 100) : 0;
        const on = mine.includes(i);
        return (
          <button key={i} type="button" className={`poll-opt ${on ? 'on' : ''}`} onClick={() => pick(i)} aria-pressed={on}>
            <span className="poll-fill" style={{ width: `${pct}%` }} />
            <span className="poll-check" aria-hidden="true">{on ? '' : ''}</span>
            <span className="poll-text">{o}</span>
            <span className="poll-count">{counts[i]}</span>
          </button>
        );
      })}
      <div className="poll-foot">
        {voters} {voters === 1 ? 'vote' : 'votes'}
        {voters > 0 && (
          <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'Who voted'}</button>
        )}
      </div>
      {open && (
        <ul className="poll-who">
          {options.map((o, i) => {
            const who = Object.entries(votes || {}).filter(([, c]) => c.includes(i)).map(([u]) => (u === meId ? 'You' : names[u] || 'Someone'));
            return who.length ? <li key={i}><strong>{o}</strong>: {who.join(', ')}</li> : null;
          })}
        </ul>
      )}
    </div>
  );
}

export function PollModal({ onClose, onSend }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const clean = opts.map((o) => o.trim()).filter(Boolean);
  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!q.trim()) return setErr('Type your question.');
    if (clean.length < 2) return setErr('Add at least 2 options.');
    if (new Set(clean.map((o) => o.toLowerCase())).size !== clean.length) return setErr('Each option must be different.');
    setBusy(true);
    const ok = await onSend({ t: 'poll', q: q.trim(), options: clean, multi });
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" role="dialog" aria-modal="true" aria-label="New poll" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head"><h3><I n="poll" /> New poll</h3><button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><I n="close" /></button></div>
        <div className="pad-field">
          <input autoFocus maxLength={200} placeholder="Question" value={q} onChange={(e) => setQ(e.target.value)} />
          {opts.map((o, i) => (
            <input key={i} style={{ marginTop: 8 }} maxLength={100} placeholder={`Option ${i + 1}`} value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} />
          ))}
          {opts.length < 6 && <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={() => setOpts([...opts, ''])}><I n="plus" /> Add option</button>}
          <label className="poll-multi"><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> Allow more than one answer</label>
          {err && <p className="form-error" role="alert">{err}</p>}
        </div>
        <div className="modal-foot row-gap"><button type="submit" className="btn-primary" disabled={busy}>Send poll</button></div>
      </form>
    </div>
  );
}

// ----- Reactions -----
export function ReactionRow({ reactions, meId, onReact, messageId }) {
  const counts = {};
  Object.values(reactions || {}).forEach((e) => {
    if (e) counts[e] = (counts[e] || 0) + 1;
  });
  const list = Object.entries(counts);
  if (!list.length) return null;
  const mine = reactions[meId];
  return (
    <div className="reaction-row">
      {list.map(([e, n]) => (
        <button key={e} type="button" className={`reaction-chip ${mine === e ? 'on' : ''}`} onClick={() => onReact(messageId, mine === e ? null : e)} aria-label={`${e} ${n}`}>
          {e}{n > 1 ? <em>{n}</em> : null}
        </button>
      ))}
    </div>
  );
}

export function ReactionPicker({ current, onPick }) {
  return (
    <div className="reaction-picker" role="group" aria-label="React">
      {REACTION_EMOJI.map((e) => (
        <button key={e} type="button" className={current === e ? 'on' : ''} onClick={() => onPick(current === e ? null : e)} aria-label={`React ${e}`}>{e}</button>
      ))}
    </div>
  );
}

// ----- View once photo / video -----
export function ViewOnceMessage({ m, mine, opened, onOpened, viewedBy }) {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(null); // { url }
  const icon = m.kind === 'video' ? '' : '';
  const what = m.kind === 'video' ? 'video' : 'photo';

  async function view() {
    setBusy(true);
    try {
      const url = await mediaUrl(m.media_path); // fetch first, so a network problem does not use up the one look
      const { data, error } = await supabase.rpc('view_once_seen', { p_message: m.id });
      if (error) throw error;
      if (!data) {
        onOpened(m.id);
        alert('This was already opened.');
        return;
      }
      onOpened(m.id);
      setShown({ url });
    } catch (e) {
      alert('Could not open it. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const viewer = shown && (
    <div className="lightbox once-view" onClick={() => setShown(null)}>
      {m.kind === 'video' ? (
        <video src={shown.url} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} controlsList="nodownload noplaybackrate" disablePictureInPicture onContextMenu={(e) => e.preventDefault()} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shown.url} alt="View once photo" draggable="false" onContextMenu={(e) => e.preventDefault()} />
      )}
      <div className="once-note">View once · closes for good when you leave</div>
    </div>
  );

  if (mine) {
    return (
      <div className="once-msg sent">
        <span className="once-ico" aria-hidden="true">{icon}</span>
        <span>View once {what} · {viewedBy > 0 ? 'Opened' : 'Not opened yet'}</span>
      </div>
    );
  }
  return (
    <>
      {opened ? (
        <div className="once-msg done">
          <span className="once-ico" aria-hidden="true">{icon}</span>
          <span>Opened</span>
        </div>
      ) : (
        <button type="button" className="once-msg" onClick={view} disabled={busy}>
          <span className="once-ico" aria-hidden="true">{icon}</span>
          <span>{busy ? 'Opening…' : `Tap to view ${what} (once)`}</span>
        </button>
      )}
      {viewer}
    </>
  );
}

// ----- Attach menu (small popover above the composer) -----
export function AttachMenu({ onPick, onClose, canLocation }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const items = [
    ['photo', IconImage, 'Photo or video'],
    ['once', IconOnce, 'View once (photo or video)'],
    ['doc', IconFile, 'Document'],
    ...(canLocation ? [['location', IconLocation, 'Location']] : []),
    ['poll', IconPoll, 'Poll'],
  ];
  // The menu sits right above the paperclip button (its parent is position: relative).
  // The see-through layer behind it closes the menu when you tap anywhere else.
  return (
    <>
      <div className="attach-bg" onClick={onClose} />
      <div className="attach-menu" role="menu">
        {items.map(([k, Icon, label]) => (
          <button key={k} type="button" role="menuitem" className={`am-${k}`} onClick={() => onPick(k)}>
            <span className="am-ico"><Icon size={20} /></span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// ----- Forward to other chats -----
export function ForwardModal({ chats, onSend, onClose }) {
  const [picked, setPicked] = useState([]);
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const shown = chats.filter((c) => !term || (c.title || '').toLowerCase().includes(term.toLowerCase()));
  function toggle(id) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 5 ? p : [...p, id]));
  }
  async function go() {
    setBusy(true);
    await onSend(picked);
    setBusy(false);
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Forward to" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3><I n="forward" /> Forward to…</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><I n="close" /></button></div>
        <div className="pad-field"><input autoFocus placeholder="Search chats" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
        <div className="forward-list">
          {shown.length === 0 && <div className="list-empty">No chats found.</div>}
          {shown.map((c) => (
            <button key={c.conversation_id} type="button" className={picked.includes(c.conversation_id) ? 'on' : ''} onClick={() => toggle(c.conversation_id)} aria-pressed={picked.includes(c.conversation_id)}>
              <span aria-hidden="true">{picked.includes(c.conversation_id) ? '' : ''}</span> {c.title}
            </button>
          ))}
        </div>
        <div className="modal-foot row-gap">
          <span className="modal-sub" style={{ margin: 0, padding: 0 }}>{picked.length}/5 chosen</span>
          <button className="btn-primary" disabled={busy || !picked.length} onClick={go}>{busy ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}
