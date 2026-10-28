// Fingerprint / face unlock for the app lock, using the phone's or computer's own screen-lock sensor
// (the browser's WebAuthn "platform authenticator"). Honest note: it works on this device only and only
// replaces typing the PIN. The PIN always stays as the fallback. Needs an https address.
const key = (uid) => `atomshade.bio.${uid}`;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function biometricSupported() {
  try {
    if (typeof window === 'undefined' || !window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) return false;
    return !!(await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export function biometricOn(uid) {
  try {
    return !!localStorage.getItem(key(uid));
  } catch {
    return false;
  }
}

export function disableBiometric(uid) {
  try {
    localStorage.removeItem(key(uid));
  } catch {
    /* ignore */
  }
}

// Asks the phone to confirm it is you (fingerprint / face / device PIN) and remembers the credential.
export async function enableBiometric(uid, label) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: 'Atomshade' },
      user: { id: new TextEncoder().encode(uid).slice(0, 64), name: label || 'Atomshade', displayName: label || 'Atomshade' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  if (!cred) throw new Error('Cancelled');
  localStorage.setItem(key(uid), b64(cred.rawId));
}

// true = the sensor said it is you. false = cancelled or failed (the PIN is still there).
export async function unlockWithBiometric(uid) {
  try {
    const id = localStorage.getItem(key(uid));
    if (!id) return false;
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: 'public-key', id: unb64(id), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!res;
  } catch {
    return false;
  }
}
