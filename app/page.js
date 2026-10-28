'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Login from '../components/Login';
import ProfileSetup from '../components/ProfileSetup';
import ChatShell from '../components/ChatShell';
import AppLockGate from '../components/AppLockGate';
import AtomLogo from '../components/AtomLogo';
import { loadMyProfile } from '../lib/profile';
import { listenForAuthLink } from '../lib/nativeAuth';

function Splash() {
  return (
    <div className="splash">
      <AtomLogo size={64} className="pulse" />
    </div>
  );
}

export default function Home() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadError, setLoadError] = useState('');

  // In the installed app, finish a login when the browser sends us back.
  useEffect(() => listenForAuthLink(), []);

  // Watch login state
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load this user's profile once logged in
  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setLoadingProfile(true);
    (async () => {
      let res = await loadMyProfile();
      // A brand-new account may need a moment before its profile row exists.
      if (!res.profile && !cancelled) {
        await new Promise((r) => setTimeout(r, 1200));
        res = await loadMyProfile();
      }
      if (cancelled) return;
      setProfile(res.profile);
      setLoadError(res.profile ? '' : 'We could not load your profile. Check your internet and try again.');
      setLoadingProfile(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (session === undefined) return <Splash />;
  if (!session) return <Login />;
  if (loadingProfile) return <Splash />;
  if (!profile) {
    return (
      <div className="splash" style={{ flexDirection: 'column', gap: 16, padding: 24, textAlign: 'center' }}>
        <p>{loadError || 'Loading...'}</p>
        <button className="btn-primary" onClick={() => supabase.auth.signOut()}>Log out</button>
        <button className="btn-ghost" onClick={() => window.location.reload()}>Try again</button>
      </div>
    );
  }
  if (!profile.name) return <ProfileSetup profile={profile} onDone={setProfile} />;
  return (
    <AppLockGate uid={profile.id}>
      <ChatShell me={profile} onProfileChange={setProfile} />
    </AppLockGate>
  );
}
