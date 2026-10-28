'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDuration, mediaUrl } from '../lib/media';

function useMediaUrl(path, enabled = true) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let off = false;
    setUrl(null);
    setFailed(false);
    if (!enabled) return undefined;
    mediaUrl(path)
      .then((u) => !off && setUrl(u))
      .catch(() => !off && setFailed(true));
    return () => {
      off = true;
    };
  }, [path, enabled]);
  return { url, failed };
}

// "Tap to download" box, shown when auto-download is off in Settings.
function TapToLoad({ label, onTap }) {
  return (
    <button type="button" className="tap-load" onClick={onTap}>
      <span aria-hidden="true">⬇</span> {label}
    </button>
  );
}

export function ImageMessage({ path, onOpen, auto = true }) {
  const [asked, setAsked] = useState(false);
  const { url, failed } = useMediaUrl(path, auto || asked);
  if (!auto && !asked) return <TapToLoad label="Tap to download photo" onTap={() => setAsked(true)} />;
  if (failed) return <div className="media-missing">Photo unavailable</div>;
  if (!url) return <div className="media-skeleton" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="chat-image" src={url} alt="Photo" onClick={() => onOpen(url)} />;
}

const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const PauseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
  </svg>
);

export function AudioMessage({ path, durationMs }) {
  const { url, failed } = useMediaUrl(path);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // milliseconds played so far
  const audioRef = useRef(null);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  if (failed) return <div className="media-missing">Voice note unavailable</div>;

  const total = durationMs || 1;
  const pct = Math.min(100, (pos / total) * 100);

  return (
    <div className="audio-msg">
      <button type="button" className="play-btn" onClick={toggle} disabled={!url} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="audio-track">
        <div className="audio-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="audio-time">{formatDuration(playing || pos ? pos : durationMs || 0)}</span>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPos(0);
          }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime * 1000)}
        />
      )}
    </div>
  );
}

export function VideoMessage({ path, auto = true }) {
  const [asked, setAsked] = useState(false);
  const { url, failed } = useMediaUrl(path, auto || asked);
  if (!auto && !asked) return <TapToLoad label="Tap to download video" onTap={() => setAsked(true)} />;
  if (failed) return <div className="media-missing">Video unavailable</div>;
  if (!url) return <div className="media-skeleton" />;
  return <video className="chat-video" src={url} controls playsInline preload="metadata" />;
}
