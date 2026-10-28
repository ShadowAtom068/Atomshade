'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import AtomLogo from './AtomLogo';
import { biometricOn, unlockWithBiometric } from '../lib/biometric';
import { clearAppLock, hasAppLock, lockDelay, lockIsSuspended, suspendAppLock, verifyAppLock } from '../lib/applock';

// Wraps the whole app. If you turned on App lock, a PIN screen covers everything until you unlock.
export default function AppLockGate({ uid, children }) {
  const [locked, setLocked] = useState(() => {
    try {
      return hasAppLock(uid);
    } catch {
      return false;
    }
  });
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [, tick] = useState(0);
  const fails = useRef(0);
  const inputRef = useRef(null);
  const contentRef = useRef(null);

  // Lock again when you come back after being away for longer than your chosen time.
  useEffect(() => {
    let hiddenAt = null;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null) {
        const away = Date.now() - hiddenAt;
        hiddenAt = null;
        if (hasAppLock(uid) && !lockIsSuspended() && away >= lockDelay(uid) * 60000) setLocked(true);
      }
    };
    const lockNow = () => hasAppLock(uid) && setLocked(true);
    // Choosing a photo or video sends the browser away for a moment: don't lock because of that.
    const onPick = (e) => {
      if (e.target && e.target.type === 'file') suspendAppLock();
    };
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('click', onPick, true);
    window.addEventListener('atomshade-lock-now', lockNow);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('click', onPick, true);
      window.removeEventListener('atomshade-lock-now', lockNow);
    };
  }, [uid]);

  // While locked, nothing underneath can be clicked, tabbed to or read by a screen reader.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (locked) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [locked]);

  useEffect(() => {
    if (locked) {
      setPin('');
      setError('');
      setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
    }
  }, [locked]);

  // Count down the wait after too many wrong tries.
  useEffect(() => {
    if (!waitUntil) return undefined;
    const id = setInterval(() => {
      if (Date.now() >= waitUntil) {
        setWaitUntil(0);
        setError('');
      }
      tick((n) => n + 1);
    }, 500);
    return () => clearInterval(id);
  }, [waitUntil]);

  const waitLeft = Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));

  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      if (busy || waitLeft > 0 || pin.length < 4) return;
      setBusy(true);
      const ok = await verifyAppLock(uid, pin);
      setBusy(false);
      if (ok) {
        fails.current = 0;
        setLocked(false);
        setPin('');
        return;
      }
      fails.current += 1;
      setPin('');
      if (fails.current >= 5) {
        const secs = Math.min(300, 30 * 2 ** Math.floor((fails.current - 5) / 1));
        setWaitUntil(Date.now() + secs * 1000);
        setError('Too many wrong tries.');
      } else {
        setError(`Wrong PIN. ${5 - fails.current} ${5 - fails.current === 1 ? 'try' : 'tries'} left before a short wait.`);
      }
    },
    [busy, waitLeft, pin, uid]
  );

  const [bioBusy, setBioBusy] = useState(false);
  async function useBio() {
    if (bioBusy) return;
    setBioBusy(true);
    const ok = await unlockWithBiometric(uid);
    setBioBusy(false);
    if (ok) {
      fails.current = 0;
      setLocked(false);
      setPin('');
      setError('');
    } else setError('Fingerprint was not accepted. Type your PIN instead.');
  }

  async function forgot() {
    if (!confirm('Log out of Atomshade on this device? Your chats stay safe in your account. You can log in again and turn the lock back on.')) return;
    clearAppLock(uid);
    await supabase.auth.signOut();
  }

  return (
    <>
      <div className="lock-content" ref={contentRef} aria-hidden={locked ? 'true' : undefined}>
        {children}
      </div>
      {locked && (
        <div className="applock" role="dialog" aria-modal="true" aria-label="Atomshade is locked">
          <form className="applock-card" onSubmit={submit}>
            <AtomLogo size={64} />
            <h2>Atomshade is locked</h2>
            <p>Enter your PIN to open your chats.</p>
            <input
              ref={inputRef}
              className="applock-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              placeholder="••••"
              aria-label="PIN"
              value={pin}
              disabled={busy || waitLeft > 0}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
            {error && (
              <div className="form-error" role="alert">
                {error}
                {waitLeft > 0 ? ` Try again in ${waitLeft}s.` : ''}
              </div>
            )}
            <button className="btn-primary" disabled={busy || waitLeft > 0 || pin.length < 4}>
              {busy ? 'Checking…' : 'Unlock'}
            </button>
            {biometricOn(uid) && (
              <button type="button" className="btn-ghost" onClick={useBio} disabled={bioBusy}>
                {bioBusy ? 'Waiting…' : 'Use fingerprint or face'}
              </button>
            )}
            <button type="button" className="btn-ghost applock-forgot" onClick={forgot}>
              Forgot PIN? Log out
            </button>
          </form>
        </div>
      )}
    </>
  );
}
