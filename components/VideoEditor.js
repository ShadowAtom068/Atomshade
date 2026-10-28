'use client';

import { I } from './Icons';
import { useEffect, useRef, useState } from 'react';
import { canTrim, extFor, fmtTime, probeVideo, SEND_TYPES, trimVideo } from '../lib/video';

const MIN_CLIP = 0.5;

// Trim a video (and optionally remove its sound) before sending or posting it.
// onDone({ blob, type, ext, durationMs }) gets the finished file. Nothing is uploaded until then.
export default function VideoEditor({ file, maxSeconds = 120, maxBytes = 50 * 1024 * 1024, doneLabel = 'Send ', onDone, onCancel }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [mute, setMute] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [url, setUrl] = useState('');
  const vid = useRef(null);
  const abort = useRef(null);
  const trimmable = canTrim();

  useEffect(() => {
    let dead = false;
    const u = URL.createObjectURL(file);
    setUrl(u);
    probeVideo(file)
      .then((i) => {
        if (dead) return;
        setInfo(i);
        setStart(0);
        setEnd(Math.min(i.duration, maxSeconds));
      })
      .catch((e) => !dead && setError(e.message));
    return () => {
      dead = true;
      URL.revokeObjectURL(u);
      if (abort.current) abort.current.abort();
    };
  }, [file, maxSeconds]);

  // Stop the preview at the end marker.
  function onTime() {
    const v = vid.current;
    if (v && !v.paused && v.currentTime >= end - 0.03) {
      v.pause();
      v.currentTime = start;
      setPlaying(false);
    }
  }
  function togglePlay() {
    const v = vid.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime >= end - 0.05) v.currentTime = start;
      v.muted = mute;
      v.play().then(() => setPlaying(true)).catch(() => setError('Your browser would not play the preview.'));
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  function changeStart(val) {
    let s = Math.min(Number(val), info.duration - MIN_CLIP);
    let e = end;
    if (e - s > maxSeconds) e = s + maxSeconds;
    if (e < s + MIN_CLIP) e = Math.min(info.duration, s + MIN_CLIP);
    setStart(s);
    setEnd(e);
    if (vid.current) { vid.current.pause(); setPlaying(false); vid.current.currentTime = s; }
  }
  function changeEnd(val) {
    let e = Math.max(Number(val), MIN_CLIP);
    let s = start;
    if (e - s > maxSeconds) s = e - maxSeconds;
    if (e < s + MIN_CLIP) s = Math.max(0, e - MIN_CLIP);
    setStart(s);
    setEnd(e);
    if (vid.current) { vid.current.pause(); setPlaying(false); vid.current.currentTime = Math.max(s, e - 0.5); }
  }

  const changed = info && (start > 0.05 || end < info.duration - 0.05 || mute);

  async function finish() {
    if (!info || working) return;
    setError('');
    // Untouched videos are sent exactly as they are (fast, no quality loss).
    if (!changed) {
      if (!SEND_TYPES.includes(file.type)) {
        if (!trimmable) return setError('This video format cannot be sent from this browser. Try an MP4 video.');
      } else if (file.size > maxBytes) {
        if (!trimmable) return setError(`This video is over ${Math.round(maxBytes / 1048576)} MB. Pick a shorter one.`);
        return setError(`This video is over ${Math.round(maxBytes / 1048576)} MB. Move the end marker earlier to cut it shorter.`);
      } else {
        return onDone({ blob: file, type: file.type, ext: extFor(file.type), durationMs: Math.round(info.duration * 1000) });
      }
    }
    if (!trimmable) return setError('Cutting videos is not supported in this browser. You can send the whole video.');
    setWorking(true);
    setProgress(0);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const out = await trimVideo(file, { start, end, mute, signal: ctl.signal, onProgress: setProgress });
      if (out.blob.size > maxBytes) {
        setWorking(false);
        return setError(`The cut video is still over ${Math.round(maxBytes / 1048576)} MB. Make it shorter.`);
      }
      onDone({ blob: out.blob, type: out.type, ext: extFor(out.type), durationMs: Math.round(out.duration * 1000) });
    } catch (e) {
      setWorking(false);
      if (e.message !== 'cancelled') setError(e.message || 'Could not prepare the video.');
    }
  }
  function cancelWork() {
    if (abort.current) abort.current.abort();
    setWorking(false);
  }

  return (
    <div className="ed-bg" role="dialog" aria-modal="true" aria-label="Video editor">
      <div className="ed-top">
        <button className="icon-btn" onClick={working ? cancelWork : onCancel} aria-label="Cancel"><I n="close" /></button>
        <div className="ed-top-mid">
          <button className={`icon-btn ${mute ? 'on' : ''}`} onClick={() => setMute((m) => !m)} aria-label={mute ? 'Sound off' : 'Sound on'} aria-pressed={mute} title="Remove sound" disabled={working}>
            {mute ? '' : ''}
          </button>
        </div>
        <button className="btn-primary ed-done" onClick={finish} disabled={!info || working}>{working ? 'Preparing…' : doneLabel}</button>
      </div>

      <div className="ed-stage">
        {error && !info ? (
          <p className="ed-loading">{error}</p>
        ) : (
          <div className="ve-wrap">
            {url && (
              <video ref={vid} className="ve-video" src={url} playsInline preload="auto" onTimeUpdate={onTime} onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} />
            )}
            {info && !working && (
              <button className="ve-play" onClick={togglePlay} aria-label={playing ? 'Pause preview' : 'Play preview'}>{playing ? '⏸' : ''}</button>
            )}
            {working && (
              <div className="ve-busy">
                <div className="ve-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                <p>Preparing your video… {Math.round(progress * 100)}%</p>
                <small>Keep this screen open until it finishes.</small>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="ed-panel">
        {!info && !error && <p className="ed-hint">Opening video…</p>}
        {info && (
          <>
            <label className="ed-slider ve-slider">Start {fmtTime(start)}
              <input type="range" min="0" max={Math.max(0, info.duration - MIN_CLIP)} step="0.1" value={start} onChange={(e) => changeStart(e.target.value)} disabled={working} aria-label="Start time" />
            </label>
            <label className="ed-slider ve-slider">End {fmtTime(end)}
              <input type="range" min={MIN_CLIP} max={info.duration} step="0.1" value={end} onChange={(e) => changeEnd(e.target.value)} disabled={working} aria-label="End time" />
            </label>
            <p className="ed-hint">
              Length {fmtTime(end - start)} of {fmtTime(info.duration)}
              {info.duration > maxSeconds ? ` · up to ${maxSeconds >= 60 ? `${Math.round(maxSeconds / 60)} min` : `${maxSeconds}s`} can be sent` : ''}
              {!trimmable ? ' · this browser can only send the whole video' : ''}
            </p>
          </>
        )}
        {error && info && <p className="form-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
