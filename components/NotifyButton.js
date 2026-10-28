'use client';

import { useEffect, useState } from 'react';
import { pushState, enablePush, disablePush } from '../lib/push';

// Used in the profile window and in the little banner at the top of the chat list.
export default function NotifyButton({ compact = false, onChange }) {
  const [state, setState] = useState('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    const s = await pushState();
    setState(s);
    if (onChange) onChange(s);
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle() {
    setBusy(true);
    setError('');
    try {
      if (state === 'on') await disablePush();
      else await enablePush();
    } catch (e) {
      setError(e.message || 'Could not change notifications.');
    }
    setBusy(false);
    refresh();
  }

  if (state === 'checking' || state === 'unsupported') return null;
  if (state === 'native') return null;
  if (state === 'ios-install') {
    return compact ? null : <p className="notify-note">On iPhone, tap Share → Add to Home Screen, then open Atomshade from your home screen to turn on notifications.</p>;
  }
  if (state === 'denied') {
    return compact ? null : <p className="notify-note">Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.</p>;
  }
  return (
    <div className={compact ? 'notify-compact' : 'notify-row'}>
      {!compact && <span>🔔 Notifications on this device: <strong>{state === 'on' ? 'On' : 'Off'}</strong></span>}
      <button type="button" className={compact ? 'btn-primary notify-btn' : 'btn-ghost'} disabled={busy} onClick={toggle}>
        {busy ? 'Please wait…' : state === 'on' ? 'Turn off' : compact ? '🔔 Turn on notifications' : 'Turn on'}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
