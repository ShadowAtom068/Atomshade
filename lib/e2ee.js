// End-to-end encryption helpers for Atomshade "Secret chats".
// Pure WebCrypto: no React, no Supabase. The private key never leaves this device
// unless you create a passphrase-protected backup.
//
//   keys     : ECDH P-256 key pair per user
//   shared   : ECDH(my private, their public) -> HKDF-SHA256 (info = conversation id) -> AES-256-GCM
//   message  : JSON {"v":1,"iv":base64,"ct":base64}  (the caller passes an `aad` string, "conversationId|senderId",
//              which is authenticated too, so a message can not be re-labelled as coming from someone else)

const enc = new TextEncoder();
const dec = new TextDecoder();
export const MAX_SECRET_CHARS = 2000;
export const BACKUP_ITERATIONS = 600000;

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('This browser cannot do secure encryption (it needs https).');
  return c.subtle;
}

export function toB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new Error('Bad encoding');
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---------- keys ----------
export async function generateIdentity() {
  const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicB64 = toB64(await subtle().exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicB64 };
}

export async function importPublic(publicB64) {
  const raw = fromB64(publicB64);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('That key does not look right');
  return subtle().importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

// ---------- shared conversation key ----------
export async function deriveConversationKey(myPrivateKey, theirPublicB64, conversationId) {
  const theirPublic = await importPublic(theirPublicB64);
  const bits = await subtle().deriveBits({ name: 'ECDH', public: theirPublic }, myPrivateKey, 256);
  const hk = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('atomshade-e2ee-v1'), info: enc.encode(String(conversationId)) },
    hk,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptText(key, plaintext, aad) {
  const text = String(plaintext);
  if (!text.length) throw new Error('Nothing to send');
  if (text.length > MAX_SECRET_CHARS) throw new Error(`Secret messages can be ${MAX_SECRET_CHARS} characters at most`);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(String(aad)) },
    key,
    enc.encode(text)
  );
  return JSON.stringify({ v: 1, iv: toB64(iv), ct: toB64(ct) });
}

// Returns the text, or null when it cannot be opened (wrong key, tampered, wrong chat).
export async function decryptText(key, body, aad) {
  try {
    const o = JSON.parse(body);
    if (!o || o.v !== 1) return null;
    const pt = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromB64(o.iv), additionalData: enc.encode(String(aad)) },
      key,
      fromB64(o.ct)
    );
    return dec.decode(pt);
  } catch (e) {
    return null;
  }
}

// ---------- safety code (both people see the same number) ----------
export async function safetyCode(pubA, pubB) {
  const [a, b] = [pubA, pubB].sort();
  const hash = new Uint8Array(await subtle().digest('SHA-256', enc.encode(`atomshade-safety-v1|${a}|${b}`)));
  const groups = [];
  for (let i = 0; i < 6; i++) {
    const n = ((hash[i * 4] << 24) | (hash[i * 4 + 1] << 16) | (hash[i * 4 + 2] << 8) | hash[i * 4 + 3]) >>> 0;
    groups.push(String(n % 100000).padStart(5, '0'));
  }
  return groups.join(' ');
}

// ---------- passphrase backup of the private key ----------
async function passKey(passphrase, salt, iterations, usage) {
  const base = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, usage);
}

export async function wrapIdentity(identity, passphrase, iterations = BACKUP_ITERATIONS) {
  if (typeof passphrase !== 'string' || passphrase.length < 10) throw new Error('Use a passphrase of at least 10 characters');
  const jwk = await subtle().exportKey('jwk', identity.privateKey);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const k = await passKey(passphrase, salt, iterations, ['encrypt']);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(jwk)));
  return { wrapped: toB64(ct), salt: toB64(salt), iv: toB64(iv), iterations };
}

// Returns an identity, or throws 'wrong passphrase'.
export async function unwrapIdentity(backup, passphrase) {
  if (!backup || backup.iterations < 100000) throw new Error('This backup cannot be used');
  let jwk;
  try {
    const k = await passKey(passphrase, fromB64(backup.salt), backup.iterations, ['decrypt']);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(backup.iv) }, k, fromB64(backup.wrapped));
    jwk = JSON.parse(dec.decode(pt));
  } catch (e) {
    throw new Error('Wrong passphrase');
  }
  const privateKey = await subtle().importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true };
  const publicKey = await subtle().importKey('jwk', pubJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const publicB64 = toB64(await subtle().exportKey('raw', publicKey));
  return { privateKey, publicKey, publicB64 };
}

// ---------- local storage of keys + pinned contacts (IndexedDB, with a memory fallback) ----------
export function memoryStore() {
  const m = new Map();
  return {
    async get(k) { return m.get(k); },
    async put(k, v) { m.set(k, v); },
    async del(k) { m.delete(k); },
  };
}

export function indexedDbStore(dbName = 'atomshade-e2ee') {
  let dbp;
  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  return {
    get: (k) => run('readonly', (s) => s.get(k)),
    put: (k, v) => run('readwrite', (s) => s.put(v, k)),
    del: (k) => run('readwrite', (s) => s.delete(k)),
  };
}

// Trust-on-first-use: remember each contact's key; shout if it changes.
export async function checkPin(store, myId, peerId, peerPublicB64) {
  const pinned = await store.get(`pin:${myId}:${peerId}`);
  if (!pinned) return 'new';
  return pinned === peerPublicB64 ? 'same' : 'changed';
}
export async function acceptPin(store, myId, peerId, peerPublicB64) {
  await store.put(`pin:${myId}:${peerId}`, peerPublicB64);
}
