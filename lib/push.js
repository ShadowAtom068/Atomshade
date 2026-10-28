import { supabase } from './supabase';

// This public key is not a secret. It only tells the browser which server may send notifications.
const VAPID_PUBLIC_KEY = 'BLfnZNlPKqtopBOvaPYfNAVL3qSQ23uorOYrfph195zlVoJiDq-u8OdfDZOqYYnpTH2P0CIBEz2VptAxJSBvL6U';

const isNative = () => typeof window !== 'undefined' && !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// 'unsupported' | 'ios-install' | 'native' | 'denied' | 'off' | 'on'
export async function pushState() {
  if (typeof window === 'undefined') return 'unsupported';
  if (isNative()) return 'native'; // the installed app will use its own notifications
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return ios ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = reg && (await reg.pushManager.getSubscription());
    return sub ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

async function subscribe() {
  const reg = (await navigator.serviceWorker.getRegistration('/sw.js')) || (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  }
  const j = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: j.endpoint,
    p_p256dh: j.keys && j.keys.p256dh,
    p_auth: j.keys && j.keys.auth,
  });
  if (error) throw error;
}

export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. You can allow them in your browser settings for this site.');
  await subscribe();
}

// Call after login: make sure this device's notifications belong to the person logged in now.
export async function refreshPushOwner() {
  try {
    if ((await pushState()) === 'on') await subscribe();
  } catch {
    /* best effort */
  }
}

// Turn off for this device (and stop the next person on a shared device from getting your alerts).
export async function disablePush(forgetBrowser = true) {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint });
      if (forgetBrowser) await sub.unsubscribe();
    }
  } catch {
    /* best effort */
  }
}
