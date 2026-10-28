import { supabase } from './supabase';

const BUCKET = 'chat-media';

// Shrinks a photo before upload so chats load fast and use little data.
// Falls back to the original file if the browser cannot read the image.
export async function compressImage(file, maxSide = 1280, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not process the photo');
  return blob;
}

// Uploads a file into the private chat-media bucket, inside a folder named
// after the conversation (the database rules use that folder name to decide who may open it).
export async function uploadMedia(conversationId, blob, ext, contentType) {
  const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType,
    cacheControl: '3600',
  });
  if (error) throw error;
  return path;
}

// Files are private, so we ask Supabase for a temporary link (valid 1 hour).
const cache = new Map();
export async function mediaUrl(path) {
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  cache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A one-time download link that saves the file under its own name (for documents).
export async function downloadUrl(path, fileName) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300, { download: fileName || true });
  if (error) throw error;
  return data.signedUrl;
}

// Copies a file that is already in the chat storage into another chat's folder (used by Forward).
export async function copyMedia(fromPath, toConversationId) {
  const ext = (fromPath.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  const toPath = `${toConversationId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).copy(fromPath, toPath);
  if (!error) return toPath;
  // Fall back to downloading and uploading again.
  const { data, error: dErr } = await supabase.storage.from(BUCKET).download(fromPath);
  if (dErr) throw dErr;
  const { error: uErr } = await supabase.storage.from(BUCKET).upload(toPath, data, { contentType: data.type || undefined, cacheControl: '3600' });
  if (uErr) throw uErr;
  return toPath;
}

// Forget the temporary photo/video links kept in memory (used by Settings → Clear cache).
export function clearMediaCache() {
  cache.clear();
}
