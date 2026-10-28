// Glue between the encryption helpers (lib/e2ee.js) and Supabase.
import { supabase } from './supabase';
import {
  generateIdentity, deriveConversationKey, encryptText, decryptText, safetyCode,
  wrapIdentity, unwrapIdentity, indexedDbStore, memoryStore, checkPin, acceptPin,
} from './e2ee';

let store = null;
function getStore() {
  if (!store) {
    try {
      store = typeof indexedDB !== 'undefined' ? indexedDbStore() : memoryStore();
    } catch (e) {
      store = memoryStore();
    }
  }
  return store;
}

const identities = new Map(); // userId -> identity (in memory while the page is open)
const convKeys = new Map(); // `${me}:${conv}:${peerKey}` -> CryptoKey

export function _resetForTests(s, sb) {
  store = s || null;
  identities.clear();
  convKeys.clear();
  if (sb) client = sb;
}
let client = supabase;
const db = () => client;

async function loadLocal(userId) {
  if (identities.has(userId)) return identities.get(userId);
  try {
    const v = await getStore().get(`id:${userId}`);
    if (v && v.privateKey && v.publicB64) {
      identities.set(userId, v);
      return v;
    }
  } catch (e) {
    /* storage blocked: behave as if there is no local key */
  }
  return null;
}
async function saveLocal(userId, identity) {
  identities.set(userId, identity);
  try {
    await getStore().put(`id:${userId}`, identity);
  } catch (e) {
    /* keep it in memory for this session */
  }
}

// state: 'ready' | 'restore' (server has a key for you but this device does not) | 'conflict'
export async function prepareKeys(userId) {
  const local = await loadLocal(userId);
  const { data: serverKey, error } = await db().rpc('get_public_key', { p_user: userId });
  if (error) return { state: 'error', error: error.message };
  if (local && !serverKey) {
    const r = await db().rpc('register_public_key', { p_key: local.publicB64, p_replace: false });
    if (r.error) return { state: 'error', error: r.error.message };
    return { state: 'ready' };
  }
  if (local && serverKey === local.publicB64) return { state: 'ready' };
  if (local) return { state: 'conflict' };
  if (!serverKey) {
    const id = await generateIdentity();
    const r = await db().rpc('register_public_key', { p_key: id.publicB64, p_replace: false });
    if (r.error) return { state: 'error', error: r.error.message };
    if (r.data === 'exists') return { state: 'restore' }; // another device registered at the same moment
    await saveLocal(userId, id);
    return { state: 'ready' };
  }
  return { state: 'restore' };
}

export async function hasBackup() {
  const { data } = await db().rpc('get_key_backup');
  return Array.isArray(data) ? data.length > 0 : !!data;
}

export async function createBackup(userId, passphrase) {
  const id = await loadLocal(userId);
  if (!id) throw new Error('No secret-chat key on this device');
  const w = await wrapIdentity(id, passphrase);
  const { error } = await db().rpc('save_key_backup', { p_wrapped: w.wrapped, p_salt: w.salt, p_iv: w.iv, p_iterations: w.iterations });
  if (error) throw new Error(error.message);
}

export async function restoreFromBackup(userId, passphrase) {
  const { data, error } = await db().rpc('get_key_backup');
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('There is no backup for this account');
  const id = await unwrapIdentity(row, passphrase);
  const { data: serverKey } = await db().rpc('get_public_key', { p_user: userId });
  if (serverKey && serverKey !== id.publicB64) throw new Error('This backup is from an older key and cannot be used');
  await saveLocal(userId, id);
  convKeys.clear();
}

// Start fresh. Old secret messages can no longer be opened; contacts will be warned the key changed.
export async function resetKeys(userId) {
  const id = await generateIdentity();
  const r = await db().rpc('register_public_key', { p_key: id.publicB64, p_replace: true });
  if (r.error) throw new Error(r.error.message);
  await db().rpc('delete_key_backup');
  await saveLocal(userId, id);
  convKeys.clear();
}

// Everything needed to talk securely with one person.
// returns { key, pinStatus: 'new'|'same'|'changed', code, peerPublic }
export async function openSecretChat(userId, convId, peerId) {
  const id = await loadLocal(userId);
  if (!id) throw new Error('Your secret-chat key is not on this device');
  const { data: peerPublic, error } = await db().rpc('get_public_key', { p_user: peerId });
  if (error) throw new Error(error.message);
  if (!peerPublic) throw new Error('This person has no secret-chat key yet');
  const ck = `${userId}:${convId}:${peerPublic}`;
  let key = convKeys.get(ck);
  if (!key) {
    key = await deriveConversationKey(id.privateKey, peerPublic, convId);
    convKeys.set(ck, key);
  }
  const pinStatus = await checkPin(getStore(), userId, peerId, peerPublic);
  const code = await safetyCode(id.publicB64, peerPublic);
  return { key, pinStatus, code, peerPublic };
}

export async function trustPeer(userId, peerId, peerPublic) {
  await acceptPin(getStore(), userId, peerId, peerPublic);
}

export const encrypt = encryptText;
export const decrypt = decryptText;
