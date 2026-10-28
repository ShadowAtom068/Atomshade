// App lock: a PIN that is asked every time Atomshade is opened (or after you leave it for a while).
// Honest note: it is stored (hashed) on THIS device only. It keeps people who pick up your phone or
// computer out. It is not the same as your account password, and forgetting it means logging in again.
import { disableBiometric } from './biometric';
import { clearPinAt, hasPinAt, readPinMeta, setPinAt, verifyPinAt } from './pinlock';

const key = (uid) => `atomshade.applock.${uid}`;

export const LOCK_DELAYS = [
  { value: 0.5, label: 'After 30 seconds' },
  { value: 1, label: 'After 1 minute' },
  { value: 15, label: 'After 15 minutes' },
  { value: 60, label: 'After 1 hour' },
];

export const hasAppLock = (uid) => hasPinAt(key(uid));
export const verifyAppLock = (uid, pin) => verifyPinAt(key(uid), pin);
export const clearAppLock = (uid) => {
  disableBiometric(uid); // fingerprint unlock only makes sense together with the PIN
  return clearPinAt(key(uid));
};
export async function setAppLock(uid, pin, afterMinutes) {
  const old = readPinMeta(key(uid));
  const after = afterMinutes ?? (old && Number.isFinite(old.after) ? old.after : 1);
  await setPinAt(key(uid), pin, { after });
}
export function lockDelay(uid) {
  const m = readPinMeta(key(uid));
  return m && Number.isFinite(m.after) ? m.after : 1;
}
export function setLockDelay(uid, after) {
  const m = readPinMeta(key(uid));
  if (!m) return;
  try {
    localStorage.setItem(key(uid), JSON.stringify({ ...m, after }));
  } catch {
    /* ignore */
  }
}

// Picking a photo or video makes the browser leave the page for a moment. Don't lock during that.
let suspendUntil = 0;
export function suspendAppLock(ms = 120000) {
  suspendUntil = Date.now() + ms;
}
export const lockIsSuspended = () => Date.now() < suspendUntil;
