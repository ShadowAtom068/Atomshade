import { supabase } from './supabase';

// Login for the installed app (Capacitor). Google does not allow sign-in inside an app's built-in
// browser, so we open the phone's real browser and come back through the link atomshade://auth-callback.
export const APP_LINK = 'atomshade://auth-callback';

export function isNativeApp() {
  return typeof window !== 'undefined' && !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function plugin(name) {
  const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name];
  if (!p) throw new Error(`The app is missing its ${name} part. Please update the app.`);
  return p;
}

export async function googleLoginNative() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: APP_LINK, skipBrowserRedirect: true },
  });
  if (error) throw error;
  await plugin('Browser').open({ url: data.url });
}

// Call once when the app starts. Finishes the login when the browser sends us back.
export function listenForAuthLink() {
  if (!isNativeApp()) return () => {};
  let handle = null;
  let gone = false;
  try {
    Promise.resolve(
      plugin('App').addListener('appUrlOpen', async ({ url }) => {
        if (!url || !url.startsWith('atomshade://')) return;
        try {
          const u = new URL(url.replace('atomshade://', 'https://atomshade.invalid/'));
          const code = u.searchParams.get('code');
          const err = u.searchParams.get('error_description');
          try { await plugin('Browser').close(); } catch { /* ignore */ }
          if (err) { alert(err); return; }
          if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) alert(error.message);
          }
        } catch (e) {
          alert(e.message || 'Login could not finish.');
        }
      })
    ).then((h) => {
      if (gone && h && h.remove) h.remove();
      else handle = h;
    });
  } catch {
    /* plugin missing: the website login still works */
  }
  return () => {
    gone = true;
    if (handle && handle.remove) handle.remove();
  };
}
