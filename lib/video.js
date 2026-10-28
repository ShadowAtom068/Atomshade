// Video helpers that run on the user's own device: read a video's length, and cut a piece out of it.
// Cutting plays the chosen part and records it again, so it takes as long as the clip itself.

export const SEND_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

export function canTrim() {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') return false;
  const v = document.createElement('video');
  return typeof v.captureStream === 'function' || typeof v.mozCaptureStream === 'function';
}

export function recorderType() {
  const list = [
    'video/mp4;codecs=avc1,mp4a.40.2', // plays on every phone
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return list.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export function extFor(type) {
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('webm')) return 'webm';
  if (type.includes('quicktime')) return 'mov';
  return 'mp4';
}

export function fmtTime(s) {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// Resolves { duration, width, height } or rejects if the browser cannot read the file.
export function probeVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (fn, val) => {
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      v.load();
      fn(val);
    };
    v.onloadedmetadata = () => {
      if (!Number.isFinite(v.duration) || v.duration <= 0) return done(reject, new Error('Could not read the video length.'));
      done(resolve, { duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    };
    v.onerror = () => done(reject, new Error('This video format is not supported here.'));
    v.src = url;
  });
}

// Records [start, end] seconds of the file. onProgress gets 0..1. Pass an AbortController signal to cancel.
export async function trimVideo(file, { start, end, mute = false, onProgress, signal }) {
  if (!canTrim()) throw new Error('Cutting videos is not supported in this browser.');
  const type = recorderType();
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.src = url;
  v.playsInline = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';

  let ctx = null;
  let stream = null;
  const cleanup = () => {
    try { v.pause(); } catch { /* ignore */ }
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { if (ctx) ctx.close(); } catch { /* ignore */ }
    URL.revokeObjectURL(url);
    v.removeAttribute('src');
    try { v.load(); } catch { /* ignore */ }
  };

  try {
    await new Promise((res, rej) => {
      v.onloadedmetadata = res;
      v.onerror = () => rej(new Error('This video format is not supported here.'));
    });
    const seek = (t) => new Promise((res) => {
      v.onseeked = () => res();
      v.currentTime = t;
    });
    await seek(start);

    const cap = v.captureStream ? v.captureStream() : v.mozCaptureStream();
    const tracks = [...cap.getVideoTracks()];
    if (!mute) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        // Route the sound into the recording only (nothing plays out loud while we record).
        ctx = new AC();
        const src = ctx.createMediaElementSource(v);
        const dest = ctx.createMediaStreamDestination();
        src.connect(dest);
        tracks.push(...dest.stream.getAudioTracks());
      } else {
        tracks.push(...cap.getAudioTracks());
      }
    }
    stream = new MediaStream(tracks);
    const rec = new MediaRecorder(stream, {
      ...(type ? { mimeType: type } : {}),
      videoBitsPerSecond: 2500000,
      audioBitsPerSecond: 96000,
    });
    const chunks = [];
    rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
    const stopped = new Promise((res) => { rec.onstop = res; });

    const length = Math.max(0.1, end - start);
    const finish = () => {
      if (rec.state !== 'inactive') rec.stop();
    };
    v.ontimeupdate = () => {
      if (onProgress) onProgress(Math.min(1, (v.currentTime - start) / length));
      if (v.currentTime >= end - 0.03) finish();
    };
    v.onended = finish;
    if (signal) signal.addEventListener('abort', finish);

    rec.start(500);
    await v.play();
    await stopped;
    if (signal && signal.aborted) throw new Error('cancelled');
    const outType = (rec.mimeType || type || 'video/webm').split(';')[0];
    const blob = new Blob(chunks, { type: outType });
    if (!blob.size) throw new Error('The cut video came out empty. Try again.');
    return { blob, type: outType, duration: length };
  } finally {
    cleanup();
  }
}
