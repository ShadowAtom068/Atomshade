'use client';

import { useState } from 'react';
import { supabase } from '../lib/supabase';
import AtomLogo from './AtomLogo';
import { APP_LINK, isNativeApp, googleLoginNative } from '../lib/nativeAuth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function google() {
    setError('');
    if (isNativeApp()) {
      try {
        await googleLoginNative();
      } catch (e) {
        setError(e.message || 'Could not start Google login.');
      }
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  }

  async function sendLink(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: isNativeApp() ? APP_LINK : window.location.origin },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <AtomLogo size={46} />
          <span className="logo-text">Atomshade</span>
        </div>

        <h1>Welcome</h1>
        <p className="sub">Log in to chat with your people.</p>
        {error && <div className="error">{error}</div>}

        <button type="button" className="btn-google" onClick={google}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.3-4 6.8-9.9 6.8-16.8z"/>
            <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/>
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.3-8.8 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
          </svg>
          Continue with Google
        </button>

        <div className="divider">
          <span>or use your email</span>
        </div>

        {sent ? (
          <p className="sub">
            Check your inbox at <b>{email}</b> and tap the login link. You can close this page.
          </p>
        ) : (
          <form onSubmit={sendLink}>
            <div className="field">
              <input
                type="email"
                placeholder="you@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <button className="btn-primary" disabled={busy || !email.includes('@')}>
              {busy ? 'Sending...' : 'Email me a login link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
