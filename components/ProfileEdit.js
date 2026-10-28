'use client';

import NotifyButton from './NotifyButton';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { cleanPhone } from '../lib/phone';
import { saveMyProfile, loadMyProfile } from '../lib/profile';
import { VIBES, vibeOf } from '../lib/vibes';
import { createBackup, hasBackup } from '../lib/secret';
import OrbitEditor from './OrbitEditor';

// "My profile": name, about, phone, vibe, Inner Orbit and secret-chat backup.
export default function ProfileEdit({ me, people = [], keyState, onSaved, onClose }) {
  const [name, setName] = useState(me.name || '');
  const [about, setAbout] = useState(me.about || '');
  const [phone, setPhone] = useState(me.phone ? `+${me.phone}` : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showOrbit, setShowOrbit] = useState(false);
  const [vibe, setVibe] = useState(vibeOf(me.vibe, me.vibe_until)?.id || '');
  const [vibeBusy, setVibeBusy] = useState(false);
  const [pass, setPass] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backedUp, setBackedUp] = useState(null);

  useEffect(() => {
    if (keyState === 'ready') hasBackup().then(setBackedUp).catch(() => setBackedUp(null));
  }, [keyState]);

  async function save(e) {
    e.preventDefault();
    setError('');
    const digits = cleanPhone(phone);
    if (phone.trim() && (digits.length < 7 || digits.length > 15)) {
      setError('That phone number does not look right. Use the full number with country code, like +2348012345678.');
      return;
    }
    setBusy(true);
    const { profile, error: saveError } = await saveMyProfile(me.id, {
      name: name.trim(),
      about: about.trim(),
      phone: digits || null,
    });
    setBusy(false);
    if (saveError || !profile) {
      const msg = saveError?.message || 'Could not save';
      setError(msg.includes('profiles_phone_unique') || msg.includes('duplicate') ? 'That phone number is already used by another account.' : msg.includes('phone') ? 'That phone number does not look right.' : msg);
      return;
    }
    onSaved(profile);
    onClose();
  }

  async function pickVibe(id) {
    setVibeBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('set_vibe', { p_vibe: id || null, p_hours: 12 });
    setVibeBusy(false);
    if (err) {
      setError(err.code === 'PGRST202' ? 'Vibes are not set up yet. Run update-security.sql in Supabase.' : err.message);
      return;
    }
    setVibe(id);
    const { profile } = await loadMyProfile();
    if (profile) onSaved(profile);
  }

  async function saveBackup() {
    setBackupBusy(true);
    setError('');
    setNotice('');
    try {
      await createBackup(me.id, pass);
      setPass('');
      setBackedUp(true);
      setNotice('Backup saved. Remember your passphrase: nobody, not even Atomshade, can recover it.');
    } catch (err) {
      setError(err.message || 'Could not save the backup');
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <>
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="modal-head">
          <h3>My profile</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="account-box">
          <small>You are signed in as</small>
          <b>{me.email || 'your account'}</b>
          <small>Other people can never see your email unless they type all of it to find you.</small>
        </div>
        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
        <div className="field">
          <label>Your name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
        </div>
        <div className="field">
          <label>About</label>
          <input value={about} onChange={(e) => setAbout(e.target.value)} maxLength={100} />
        </div>
        <NotifyButton />
        <div className="field">
          <label>Phone number (optional)</label>
          <input
            type="tel"
            inputMode="tel"
            placeholder="+234 801 234 5678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={20}
          />
          <small className="hint">Friends can find you only if they type your whole number. It is never shown to anyone.</small>
        </div>
        <div className="modal-foot">
          <button className="btn-primary" disabled={busy || name.trim().length < 2}>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </div>

        <div className="section">
          <h4>Vibe <small>(fades after 12 hours)</small></h4>
          <div className="vibe-grid">
            {VIBES.map((v) => (
              <button type="button" key={v.id} disabled={vibeBusy} className={`vibe-chip ${vibe === v.id ? 'on' : ''}`} onClick={() => pickVibe(v.id)}>
                {v.icon} {v.label}
              </button>
            ))}
            {vibe && (
              <button type="button" disabled={vibeBusy} className="vibe-chip" onClick={() => pickVibe('')}>
                ✕ Clear
              </button>
            )}
          </div>
        </div>

        <div className="section">
          <h4>✦ Inner Orbit</h4>
          <p className="hint">Choose the few people who can see your private status updates.</p>
          <button type="button" className="btn-ghost" onClick={() => setShowOrbit(true)}>Choose people</button>
        </div>

        <div className="section">
          <h4>🔒 Secret chat backup</h4>
          {keyState !== 'ready' ? (
            <p className="hint">Secret chats are not ready on this device yet.</p>
          ) : (
            <>
              <p className="hint">
                Your secret-chat key lives only on this device. {backedUp ? 'You have a backup.' : 'Without a backup, losing this device means losing your secret messages.'}{' '}
                A backup is locked with a passphrase that only you know.
              </p>
              <input type="password" placeholder="New passphrase (10+ characters)" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
              <button type="button" className="btn-ghost" disabled={backupBusy || pass.length < 10} onClick={saveBackup}>
                {backupBusy ? 'Saving...' : backedUp ? 'Replace backup' : 'Save backup'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
    {showOrbit && <OrbitEditor me={me} people={people} onClose={() => setShowOrbit(false)} />}
    </>
  );
}
