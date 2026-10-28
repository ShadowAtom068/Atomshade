'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import AtomLogo from './AtomLogo';
import { cleanPhone } from '../lib/phone';
import { saveMyProfile } from '../lib/profile';

export default function ProfileSetup({ profile, onDone }) {
  const [name, setName] = useState('');
  const [about, setAbout] = useState(profile.about || '');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // If they logged in with Google, start with their Google name.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const n = data?.user?.user_metadata?.full_name || data?.user?.user_metadata?.name;
      if (n) setName((cur) => cur || n);
    });
  }, []);

  async function save(e) {
    e.preventDefault();
    const digits = cleanPhone(phone);
    if (phone.trim() && (digits.length < 7 || digits.length > 15)) {
      setError('That phone number does not look right. Use the full number with country code, like +2348012345678.');
      return;
    }
    setBusy(true);
    setError('');
    const update = { name: name.trim(), about: about.trim() };
    if (digits) update.phone = digits;
    const { profile: saved, error } = await saveMyProfile(profile.id, update);
    setBusy(false);
    if (error || !saved) setError(error?.message || 'Could not save. Please try again.');
    else onDone(saved);
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={save}>
        <div className="auth-brand">
          <AtomLogo size={46} />
          <span className="logo-text">Atomshade</span>
        </div>
        <h1>Set up your profile</h1>
        <p className="sub">This is how your friends will see you.</p>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label>Your name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus required />
        </div>
        <div className="field">
          <label>About</label>
          <input value={about} onChange={(e) => setAbout(e.target.value)} maxLength={100} />
        </div>
        <div className="field">
          <label>Phone number (optional)</label>
          <input type="tel" inputMode="tel" placeholder="+234 801 234 5678" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
        </div>
        <button className="btn-primary" disabled={busy || name.trim().length < 2}>
          {busy ? 'Saving...' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
