'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import NotifyButton from './NotifyButton';
import { disablePush } from '../lib/push';
import { clearMediaCache } from '../lib/media';
import { WALLPAPERS, setPref, usePrefs } from '../lib/prefs';
import { LOCK_DELAYS, clearAppLock, hasAppLock, lockDelay, setAppLock, setLockDelay, verifyAppLock } from '../lib/applock';
import { validPin } from '../lib/pinlock';
import { biometricOn, biometricSupported, disableBiometric, enableBiometric } from '../lib/biometric';
import { backupAllChats, downloadText } from '../lib/exportChat';

function Switch({ on, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function Row({ title, hint, children }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

function Group({ icon, title, children }) {
  return (
    <section className="set-group">
      <h4>
        <span aria-hidden="true">{icon}</span> {title}
      </h4>
      {children}
    </section>
  );
}

const mb = (n) => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB` : `${Math.max(0.1, n / 1024 / 1024).toFixed(1)} MB`);

// ----- App lock: turn on, change, turn off -----
function AppLockDialog({ uid, mode, onDone, onClose }) {
  const [cur, setCur] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const digits = (setter) => (e) => setter(e.target.value.replace(/\D/g, '').slice(0, 8));
  const needCurrent = mode === 'off' || mode === 'change';
  const needNew = mode === 'on' || mode === 'change';

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (needCurrent && !(await verifyAppLock(uid, cur))) {
        setErr('Wrong PIN.');
        setCur('');
        return;
      }
      if (needNew) {
        if (!validPin(pin)) return setErr('Use 4 to 8 digits.');
        if (pin !== again) return setErr('The two PINs do not match.');
        await setAppLock(uid, pin);
      } else {
        clearAppLock(uid);
      }
      onDone();
    } catch (ex) {
      setErr(ex.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-bg" style={{ zIndex: 70 }} onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h3>{mode === 'on' ? 'Turn on App lock' : mode === 'change' ? 'Change PIN' : 'Turn off App lock'}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="modal-sub">
          {mode === 'on'
            ? 'Pick 4 to 8 digits. Atomshade will ask for it when you open the app. It is saved on this device only, so write it down somewhere safe.'
            : mode === 'change'
            ? 'Enter your current PIN, then a new one.'
            : 'Enter your PIN to turn the lock off.'}
        </p>
        <div className="pad-field">
          {needCurrent && <input autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={8} placeholder="Current PIN" value={cur} onChange={digits(setCur)} />}
          {needNew && (
            <>
              <input autoFocus={!needCurrent} type="password" inputMode="numeric" autoComplete="off" maxLength={8} placeholder="New PIN" value={pin} onChange={digits(setPin)} style={needCurrent ? { marginTop: 8 } : undefined} />
              <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} placeholder="Repeat new PIN" value={again} onChange={digits(setAgain)} style={{ marginTop: 8 }} />
            </>
          )}
          {err && <p className="form-error" role="alert">{err}</p>}
        </div>
        <div className="modal-foot row-gap">
          <button type="submit" className="btn-primary" disabled={busy}>{mode === 'off' ? 'Turn off' : 'Save PIN'}</button>
        </div>
      </form>
    </div>
  );
}

// ----- Delete account -----
function DeleteDialog({ me, onClose, onDeleted }) {
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go(e) {
    e.preventDefault();
    if (word !== 'DELETE') return;
    setBusy(true);
    setErr('');
    const { error } = await supabase.rpc('delete_my_account', { p_confirm: 'DELETE' });
    if (error) {
      setBusy(false);
      setErr(error.code === 'PGRST202' ? 'Account deletion is not switched on yet. Run update-settings-delete.sql in Supabase (see UPDATE-v0.7.1.md).' : error.message);
      return;
    }
    onDeleted();
  }
  return (
    <div className="modal-bg" style={{ zIndex: 70 }} onClick={busy ? undefined : onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={go}>
        <div className="modal-head">
          <h3>Delete my account</h3>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
        </div>
        <div className="del-body">
          <p>This <b>permanently</b> removes <b>{me.email}</b> and cannot be undone.</p>
          <ul>
            <li>Your profile, statuses, Shades, calls history and settings are deleted.</li>
            <li>Every message you sent is deleted for everyone.</li>
            <li>Groups you are in keep going without you.</li>
            <li>Your secret-chat keys can never be recovered.</li>
          </ul>
          <label className="del-label" htmlFor="del-word">Type <b>DELETE</b> to confirm</label>
          <input id="del-word" autoFocus autoComplete="off" autoCapitalize="characters" value={word} onChange={(e) => setWord(e.target.value)} placeholder="DELETE" />
          {err && <p className="form-error" role="alert">{err}</p>}
        </div>
        <div className="modal-foot row-gap">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Keep my account</button>
          <button type="submit" className="btn-danger" disabled={busy || word !== 'DELETE'}>{busy ? 'Deleting…' : 'Delete forever'}</button>
        </div>
      </form>
    </div>
  );
}

export default function SettingsPanel({ me, onClose, onEditProfile, onOpenStarred, onShowOnlineChange, onLogout }) {
  const prefs = usePrefs();
  const [remote, setRemote] = useState(null); // { read_receipts, show_online } or false if not set up
  const [blocked, setBlocked] = useState(null);
  const [error, setError] = useState('');
  const [lockOn, setLockOn] = useState(() => hasAppLock(me.id));
  const [delay, setDelay] = useState(() => lockDelay(me.id));
  const [lockDlg, setLockDlg] = useState(null);
  const [delDlg, setDelDlg] = useState(false);
  const [usage, setUsage] = useState(null);
  const [cleared, setCleared] = useState('');
  const [bioOk, setBioOk] = useState(false);
  const [bioOn, setBioOn] = useState(() => biometricOn(me.id));
  const [bioMsg, setBioMsg] = useState('');
  const [backup, setBackup] = useState('');
  const [backingUp, setBackingUp] = useState(false);
  const [othersMsg, setOthersMsg] = useState('');
  useEffect(() => {
    biometricSupported().then(setBioOk);
  }, []);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('get_my_settings');
    if (e) setRemote(false);
    else setRemote(Array.isArray(data) ? data[0] || { read_receipts: true, show_online: true } : data && typeof data === 'object' ? data : { read_receipts: true, show_online: true });
    const b = await supabase.rpc('my_blocked');
    setBlocked(!b.error && Array.isArray(b.data) ? b.data : []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const refreshUsage = useCallback(async () => {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const { usage: u, quota } = await navigator.storage.estimate();
        setUsage({ used: u || 0, quota: quota || 0 });
      } else setUsage(false);
    } catch {
      setUsage(false);
    }
  }, []);
  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && !lockDlg && !delDlg && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, lockDlg, delDlg]);

  async function setRemoteField(field, value) {
    setError('');
    const before = remote;
    setRemote({ ...remote, [field]: value });
    const { error: e } = await supabase.rpc('set_my_setting', { p_field: field, p_value: value });
    if (e) {
      setRemote(before);
      setError(e.message);
      return;
    }
    if (field === 'show_online') onShowOnlineChange && onShowOnlineChange(value);
  }

  async function unblock(p) {
    const { error: e } = await supabase.rpc('unblock_user', { p_user: p.id });
    if (e) setError(e.message);
    else setBlocked((list) => (list || []).filter((x) => x.id !== p.id));
  }

  async function clearCache() {
    setCleared('');
    try {
      clearMediaCache();
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      try {
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
      setCleared('Cache cleared. Photos and videos will load again when you open them.');
    } catch {
      setCleared('Could not clear the cache on this browser.');
    }
    refreshUsage();
  }

  async function toggleBio(v) {
    setBioMsg('');
    if (!v) {
      disableBiometric(me.id);
      setBioOn(false);
      return;
    }
    try {
      await enableBiometric(me.id, me.email);
      setBioOn(true);
    } catch (e) {
      setBioMsg(e && e.name === 'NotAllowedError' ? 'Cancelled. Fingerprint unlock was not turned on.' : 'Could not turn on fingerprint unlock on this device.');
    }
  }

  async function runBackup() {
    setBackingUp(true);
    setBackup('Preparing…');
    try {
      const { text, count } = await backupAllChats(me.id, (i, n, title) => setBackup(`Saving ${i} of ${n}: ${title}`));
      downloadText(`Atomshade_backup_${new Date().toISOString().slice(0, 10)}.txt`, text);
      setBackup(`Saved ${count} ${count === 1 ? 'chat' : 'chats'} to a text file on this device.`);
    } catch (e) {
      setBackup('Could not make the backup: ' + (e.message || e));
    } finally {
      setBackingUp(false);
    }
  }

  async function logOutOthers() {
    if (!confirm('Log Atomshade out on all your OTHER phones and computers? You stay logged in here.')) return;
    setOthersMsg('');
    try {
      const res = await supabase.auth.signOut({ scope: 'others' });
      const e = res && res.error;
      setOthersMsg(e ? 'Could not do that: ' + e.message : 'Done. Every other device is logged out.');
    } catch (err) {
      setOthersMsg('Could not do that: ' + (err.message || err));
    }
  }

  async function afterDelete() {
    clearAppLock(me.id);
    try {
      await disablePush(false);
    } catch {
      /* ignore */
    }
    try {
      await supabase.auth.signOut();
    } catch {
      /* the account is gone; a failed sign-out changes nothing */
    }
    window.location.reload();
  }

  const setupMissing = remote === false;

  return (
    <div className="modal-bg settings-bg" onClick={onClose}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⚙ Settings</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">✕</button>
        </div>
        <div className="settings-body">
          {error && <div className="error" role="alert">{error}</div>}

          <button type="button" className="set-account" onClick={onEditProfile}>
            <span className="me-initial">{(me.name || me.email || '?').trim().charAt(0).toUpperCase()}</span>
            <span className="me-text">
              <b>{me.name || 'Your profile'}</b>
              <small>{me.email}</small>
            </span>
            <span className="set-chev" aria-hidden="true">›</span>
          </button>

          <Group icon="🔐" title="Privacy">
            {setupMissing ? (
              <p className="set-note">Privacy options need the latest database update (update-settings.sql).</p>
            ) : (
              <>
                <Row title="Read receipts" hint="When off, people can’t see when you have read their messages (the ticks stay grey).">
                  <Switch label="Read receipts" on={!!remote?.read_receipts} disabled={!remote} onChange={(v) => setRemoteField('read_receipts', v)} />
                </Row>
                <Row title="Show when I’m online" hint="When off, you won’t show as online to others. Atomshade never shows “last seen”.">
                  <Switch label="Show when I'm online" on={!!remote?.show_online} disabled={!remote} onChange={(v) => setRemoteField('show_online', v)} />
                </Row>
              </>
            )}
            <div className="set-sub">
              <b>Blocked people</b>
              {blocked === null ? (
                <small>Loading…</small>
              ) : blocked.length === 0 ? (
                <small>You haven’t blocked anyone.</small>
              ) : (
                <ul className="blocked-list">
                  {blocked.map((p) => (
                    <li key={p.id}>
                      <span>{p.name || 'Someone'}</span>
                      <button type="button" className="btn-ghost" onClick={() => unblock(p)}>Unblock</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Group>

          <Group icon="🛡" title="Security">
            <Row title="App lock" hint="Ask for a PIN every time Atomshade is opened. Saved on this device only.">
              <Switch label="App lock" on={lockOn} onChange={(v) => setLockDlg(v ? 'on' : 'off')} />
            </Row>
            {lockOn && (
              <>
                <Row title="Lock after">
                  <select
                    aria-label="Lock after"
                    value={delay}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setDelay(v);
                      setLockDelay(me.id, v);
                    }}
                  >
                    {LOCK_DELAYS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </Row>
                {bioOk && (
                  <Row title="Fingerprint / face unlock" hint="Open with your phone’s sensor instead of typing the PIN. The PIN still works.">
                    <Switch label="Fingerprint or face unlock" on={bioOn} onChange={toggleBio} />
                  </Row>
                )}
                {bioMsg && <small role="status">{bioMsg}</small>}
                <div className="set-actions">
                  <button type="button" className="btn-ghost" onClick={() => setLockDlg('change')}>Change PIN</button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      onClose();
                      window.dispatchEvent(new Event('atomshade-lock-now'));
                    }}
                  >
                    Lock now
                  </button>
                </div>
              </>
            )}
            <p className="set-note">To hide single chats, press and hold a chat (or right-click it) and choose Lock chat.</p>
          </Group>

          <Group icon="💬" title="Chats">
            <div className="set-sub">
              <b>Theme</b>
              <div className="seg" role="radiogroup" aria-label="Theme">
                {[
                  ['dark', '🌙 Dark'],
                  ['light', '☀ Light'],
                  ['system', '📱 Device'],
                ].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={prefs.theme === v} className={prefs.theme === v ? 'on' : ''} onClick={() => setPref('theme', v)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="set-sub">
              <b>Chat wallpaper</b>
              <div className="wall-grid" role="radiogroup" aria-label="Chat wallpaper">
                {WALLPAPERS.map((w) => (
                  <button key={w.id} type="button" role="radio" aria-checked={prefs.wallpaper === w.id} className={`wall-swatch wp-${w.id} ${prefs.wallpaper === w.id ? 'on' : ''}`} onClick={() => setPref('wallpaper', w.id)}>
                    <span>{w.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="set-sub">
              <b>Text size</b>
              <div className="seg" role="radiogroup" aria-label="Text size">
                {[
                  ['normal', 'Normal'],
                  ['large', 'Large'],
                ].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={prefs.fontSize === v} className={prefs.fontSize === v ? 'on' : ''} onClick={() => setPref('fontSize', v)}>{l}</button>
                ))}
              </div>
            </div>
            <button type="button" className="set-link" onClick={onOpenStarred}>
              <span>⭐ Starred messages</span>
              <span className="set-chev" aria-hidden="true">›</span>
            </button>
            <p className="set-note">Disappearing messages are set for each chat: open a chat, tap ⋮, then “Disappearing messages”.</p>
          </Group>

          <Group icon="🔔" title="Notifications">
            <NotifyButton />
          </Group>

          <Group icon="💾" title="Storage and data">
            <Row title="Auto-download photos" hint="When off, you tap a photo to download it. Saves data.">
              <Switch label="Auto-download photos" on={prefs.autoImages} onChange={(v) => setPref('autoImages', v)} />
            </Row>
            <Row title="Auto-download videos" hint="Videos use the most data. Turn off to tap before they download.">
              <Switch label="Auto-download videos" on={prefs.autoVideos} onChange={(v) => setPref('autoVideos', v)} />
            </Row>
            <div className="set-sub">
              <b>Used on this device</b>
              <small>
                {usage === null ? 'Checking…' : usage === false ? 'Your browser does not tell us.' : `${mb(usage.used)}${usage.quota ? ` of ${mb(usage.quota)} available` : ''}`}
              </small>
              <div className="set-actions">
                <button type="button" className="btn-ghost" onClick={clearCache}>Clear cache</button>
              </div>
              {cleared && <small role="status">{cleared}</small>}
              <small>Clearing the cache never deletes your chats, or the keys for your secret chats.</small>
            </div>
            <div className="set-sub">
              <b>Back up my chats</b>
              <small>Saves all your normal chats as one text file on this device (words only, no photos). For a secret chat, open it and use ⋮ → Export chat.</small>
              <div className="set-actions">
                <button type="button" className="btn-ghost" onClick={runBackup} disabled={backingUp}>{backingUp ? 'Saving…' : '⬇ Save a copy'}</button>
              </div>
              {backup && <small role="status">{backup}</small>}
            </div>
          </Group>

          <Group icon="👤" title="Account">
            <div className="set-actions">
              <button type="button" className="btn-ghost" onClick={onLogout}>Log out</button>
              <button type="button" className="btn-ghost" onClick={logOutOthers}>Log out other devices</button>
              <button type="button" className="btn-danger-ghost" onClick={() => setDelDlg(true)}>Delete my account</button>
            </div>
            {othersMsg && <small role="status">{othersMsg}</small>}
            <p className="set-note">Atomshade v0.7.1 · your email: {me.email}</p>
          </Group>
        </div>
      </div>

      {lockDlg && (
        <AppLockDialog
          uid={me.id}
          mode={lockDlg}
          onClose={() => setLockDlg(null)}
          onDone={() => {
            setLockOn(hasAppLock(me.id));
            setDelay(lockDelay(me.id));
            setLockDlg(null);
          }}
        />
      )}
      {delDlg && <DeleteDialog me={me} onClose={() => setDelDlg(false)} onDeleted={afterDelete} />}
    </div>
  );
}
