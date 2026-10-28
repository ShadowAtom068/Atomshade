'use client';

import { useEffect, useRef, useState } from 'react';
import { hasPin, setPin, validPin, verifyPin } from '../lib/pinlock';

// Right-click / long-press menu for a chat in the list.
export function ChatContextMenu({ chat, x, y, onPick, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({
        left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
      });
      el.querySelector('button')?.focus();
    }
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [x, y, onClose]);

  return (
    <div className="ctx-bg" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div ref={ref} className="ctx-menu" role="menu" style={pos} onClick={(e) => e.stopPropagation()}>
        <div className="ctx-title">{chat.title}</div>
        <button role="menuitem" onClick={() => onPick('rename')}>✏️ Edit name</button>
        <button role="menuitem" onClick={() => onPick('archive')}>{chat.archived ? '📤 Unarchive' : '📥 Archive'}</button>
        <button role="menuitem" onClick={() => onPick('pin')}>{chat.pinned ? '📌 Unpin chat' : '📌 Pin chat'}</button>
        <button role="menuitem" onClick={() => onPick('mute')}>{chat.muted ? '🔔 Unmute notifications' : '🔕 Mute notifications'}</button>
        <button role="menuitem" onClick={() => onPick('lock')}>{chat.locked ? '🔓 Unlock chat' : '🔒 Lock chat'}</button>
      </div>
    </div>
  );
}

// Choose how long to silence a chat. Messages still arrive; you just get no alert.
export function MuteModal({ chat, onPick, onClose }) {
  const choices = [
    [8, '8 hours'],
    [168, '1 week'],
    [-1, 'Always'],
  ];
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Mute notifications" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>🔕 Mute {chat.title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <p className="modal-sub">You will not get notifications from this chat. Calls still ring. Messages still arrive.</p>
        <div className="radio-list">
          {choices.map(([h, label]) => (
            <button key={h} type="button" onClick={() => onPick(h)}><span className="radio-dot" aria-hidden="true" />{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RenameModal({ chat, onSave, onClose }) {
  const [val, setVal] = useState(chat.nickname || '');
  const [busy, setBusy] = useState(false);
  const isGroup = chat.is_group;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    await onSave(val.trim());
    setBusy(false);
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="modal-head">
          <h3>Edit name</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="modal-sub">
          {isGroup ? 'This name is only for you. Group admins can change it for everyone in Group info.' : `This name is only for you. ${chat.real_title || 'They'} will not see it.`}
        </p>
        <div className="pad-field">
          <input autoFocus maxLength={40} value={val} placeholder={chat.real_title || 'Name'} onChange={(e) => setVal(e.target.value)} />
        </div>
        <div className="modal-foot row-gap">
          <button type="button" className="btn-ghost" onClick={() => onSave('')} disabled={busy || !chat.nickname}>Reset</button>
          <button type="submit" className="btn-primary" disabled={busy}>Save</button>
        </div>
      </form>
    </div>
  );
}

// mode: 'set' (first time), 'enter' (open locked chats)
export function PinModal({ userId, mode, onDone, onClose }) {
  const [pin, setPinVal] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const setting = mode === 'set';

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!validPin(pin)) return setErr('Use 4 to 8 digits.');
    setBusy(true);
    try {
      if (setting) {
        if (pin !== again) {
          setErr('The two PINs do not match.');
          return;
        }
        await setPin(userId, pin);
        onDone();
      } else if (await verifyPin(userId, pin)) {
        onDone();
      } else {
        setErr('Wrong PIN.');
        setPinVal('');
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h3>{setting ? 'Create a lock PIN' : 'Locked chats'}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="modal-sub">
          {setting
            ? 'Pick 4 to 8 digits. It is saved on this device only. If you forget it, clearing this browser’s data resets it, but locked chats then show normally again.'
            : 'Enter your PIN to see locked chats.'}
        </p>
        <div className="pad-field">
          <input autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={8} placeholder="PIN" value={pin} onChange={(e) => setPinVal(e.target.value.replace(/\D/g, ''))} />
          {setting && (
            <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} placeholder="Repeat PIN" value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} style={{ marginTop: 8 }} />
          )}
          {err && <p className="form-error" role="alert">{err}</p>}
        </div>
        <div className="modal-foot row-gap">
          <button type="submit" className="btn-primary" disabled={busy}>{setting ? 'Save PIN' : 'Open'}</button>
        </div>
      </form>
    </div>
  );
}

export { hasPin };
