'use client';

import { useEffect, useRef, useState } from 'react';
import { EMOJI_GRID, GIPHY_KEY, MAX_MY_STICKERS, STICKER_PACKS, loadMyStickers, makeSticker, saveMyStickers, searchGifs } from '../lib/stickers';

// The panel that opens above the typing bar: emoji, stickers, GIFs and my own stickers.
export default function StickerPanel({ uid, onEmoji, onSticker, onMine, onGif, onClose, canSend = true }) {
  const [tab, setTab] = useState(canSend ? 'stickers' : 'emoji');
  const [pack, setPack] = useState(STICKER_PACKS[0].id);
  const [mine, setMine] = useState(() => loadMyStickers(uid));
  const [gifs, setGifs] = useState(null);
  const [gifQ, setGifQ] = useState('');
  const [gifErr, setGifErr] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  useEffect(() => {
    if (tab !== 'gif' || !GIPHY_KEY) return undefined;
    let off = false;
    setGifErr('');
    const t = setTimeout(() => {
      searchGifs(gifQ.trim())
        .then((g) => !off && setGifs(g))
        .catch((e) => !off && (setGifs([]), setGifErr(e.message || 'GIF search failed')));
    }, gifQ ? 450 : 0);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [tab, gifQ]);

  async function addMine(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return setNote('Please choose a picture.');
    if (mine.length >= MAX_MY_STICKERS) return setNote(`You can keep ${MAX_MY_STICKERS} stickers. Remove one first.`);
    try {
      const url = await makeSticker(file);
      const next = [url, ...mine];
      if (!saveMyStickers(uid, next)) return setNote('This device has no room left to save it.');
      setMine(next);
      setNote('');
    } catch {
      setNote('Could not use that picture.');
    }
  }
  function removeMine(i) {
    const next = mine.filter((_, j) => j !== i);
    saveMyStickers(uid, next);
    setMine(next);
  }

  const tabs = [['emoji', '😊', 'Emoji'], ...(canSend ? [['stickers', '🎭', 'Stickers'], ...(GIPHY_KEY ? [['gif', 'GIF', 'GIF']] : []), ['mine', '⭐', 'Mine']] : [])];
  const cur = STICKER_PACKS.find((p) => p.id === pack) || STICKER_PACKS[0];

  return (
    <div className="sticker-panel" role="dialog" aria-label="Emoji and stickers">
      <div className="sticker-tabs" role="tablist">
        {tabs.map(([k, ico, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} title={label}>{ico}<span>{label}</span></button>
        ))}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close emoji panel">✕</button>
      </div>
      <div className="sticker-body">
        {tab === 'emoji' && (
          <div className="emoji-grid">
            {EMOJI_GRID.map((e) => (
              <button key={e} type="button" onClick={() => onEmoji(e)} aria-label={`Emoji ${e}`}>{e}</button>
            ))}
          </div>
        )}
        {tab === 'stickers' && (
          <>
            <div className="pack-row" role="tablist" aria-label="Sticker packs">
              {STICKER_PACKS.map((p) => (
                <button key={p.id} type="button" role="tab" aria-selected={pack === p.id} className={pack === p.id ? 'on' : ''} onClick={() => setPack(p.id)} title={p.label}>{p.icon}</button>
              ))}
            </div>
            <div className="sticker-grid">
              {cur.items.map((s) => (
                <button key={s} type="button" onClick={() => onSticker(s)} aria-label={`Send sticker ${s}`}>{s}</button>
              ))}
            </div>
          </>
        )}
        {tab === 'gif' && (
          <>
            <input className="gif-search" type="search" placeholder="Search GIFs" value={gifQ} onChange={(e) => setGifQ(e.target.value)} maxLength={60} aria-label="Search GIFs" />
            {gifErr && <p className="form-error" role="alert">{gifErr}</p>}
            <div className="gif-grid">
              {(gifs || []).map((g) => (
                // eslint-disable-next-line @next/next/no-img-element
                <button key={g.id} type="button" onClick={() => onGif(g)} aria-label="Send this GIF"><img src={g.preview} alt="GIF" loading="lazy" /></button>
              ))}
              {gifs && gifs.length === 0 && !gifErr && <div className="list-empty">No GIFs found.</div>}
            </div>
            <small className="gif-credit">Powered by GIPHY</small>
          </>
        )}
        {tab === 'mine' && (
          <>
            <div className="sticker-grid mine">
              <button type="button" className="add-sticker" onClick={() => fileRef.current?.click()} aria-label="Add a sticker from a picture">＋</button>
              {mine.map((u, i) => (
                <span key={i} className="mine-wrap">
                  <button type="button" onClick={() => onMine(u)} aria-label="Send my sticker">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={u} alt="My sticker" /></button>
                  <button type="button" className="mine-x" onClick={() => removeMine(i)} aria-label="Remove this sticker">✕</button>
                </span>
              ))}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={addMine} />
            <small>{note || 'Tap ＋ to turn any picture into a sticker. They are kept on this device.'}</small>
          </>
        )}
      </div>
    </div>
  );
}
