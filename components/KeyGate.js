'use client';

import { useState } from 'react';
import { restoreFromBackup, resetKeys } from '../lib/secret';

// Shown when this device does not hold your secret-chat key.
export default function KeyGate({ userId, state, onDone, onClose }) {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function restore(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await restoreFromBackup(userId, pass);
      onDone();
    } catch (err) {
      setError(err.message || 'Could not restore');
    } finally {
      setBusy(false);
    }
  }

  async function fresh() {
    if (
      !confirm(
        'Start fresh?\n\nSecret messages you already have can NOT be opened any more, and your secret-chat contacts will see a "safety code changed" warning. Normal chats are not affected.'
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await resetKeys(userId);
      onDone();
    } catch (err) {
      setError(err.message || 'Could not reset');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={restore}>
        <div className="modal-head">
          <h3>🔒 Secret chat key</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="modal-sub">
          {state === 'conflict'
            ? 'Your secret-chat key was changed from another device, so this device cannot open secret chats yet.'
            : 'This device does not have your secret-chat key yet.'}{' '}
          If you saved a passphrase backup, type it here to unlock your old secret chats.
        </p>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label>Backup passphrase</label>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" />
        </div>
        <div className="modal-foot" style={{ display: 'grid', gap: 10 }}>
          <button className="btn-primary" disabled={busy || pass.length < 10}>{busy ? 'Working...' : 'Restore my key'}</button>
          <button type="button" className="btn-danger" onClick={fresh} disabled={busy}>
            I have no backup: start fresh
          </button>
        </div>
      </form>
    </div>
  );
}
