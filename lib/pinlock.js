// Locked chats: a PIN stored (hashed) on THIS device only.
// Honest note: this hides chats from someone who picks up your unlocked phone.
// It is not encryption. Your account password and secret-chat keys are separate.

const key = (uid) => `atomshade.pin.${uid}`;
const enc = new TextEncoder();

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
async function derive(pin, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 200000 }, base, 256);
  return toHex(bits);
}

// Generic helpers (the same hashing is used by the chat-lock PIN and the app-lock PIN).
export function hasPinAt(k) {
  try {
    return !!localStorage.getItem(k);
  } catch {
    return false;
  }
}
export async function setPinAt(k, pin, extra = {}) {
  if (!validPin(pin)) throw new Error('PIN must be 4 to 8 digits.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt);
  localStorage.setItem(k, JSON.stringify({ ...extra, salt: toHex(salt), hash }));
}
export async function verifyPinAt(k, pin) {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return false;
    const { salt, hash } = JSON.parse(raw);
    return (await derive(pin, fromHex(salt))) === hash;
  } catch {
    return false;
  }
}
export function readPinMeta(k) {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null') || null;
  } catch {
    return null;
  }
}
export function clearPinAt(k) {
  try {
    localStorage.removeItem(k);
  } catch {}
}

export function hasPin(uid) {
  try {
    return !!localStorage.getItem(key(uid));
  } catch {
    return false;
  }
}

export function validPin(pin) {
  return /^\d{4,8}$/.test(pin || '');
}

export async function setPin(uid, pin) {
  if (!validPin(pin)) throw new Error('PIN must be 4 to 8 digits.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt);
  localStorage.setItem(key(uid), JSON.stringify({ salt: toHex(salt), hash }));
}

export async function verifyPin(uid, pin) {
  try {
    const raw = localStorage.getItem(key(uid));
    if (!raw) return false;
    const { salt, hash } = JSON.parse(raw);
    return (await derive(pin, fromHex(salt))) === hash;
  } catch {
    return false;
  }
}

export function clearPin(uid) {
  try {
    localStorage.removeItem(key(uid));
  } catch {}
}
