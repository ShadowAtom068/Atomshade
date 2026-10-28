// Built-in stickers and emoji, plus "my stickers" saved on this device.
export const STICKER_PACKS = [
  { id: 'faces', icon: '😎', label: 'Faces', items: ['😎', '🤩', '🥳', '😂', '🤣', '😭', '🥹', '😍', '😘', '🤗', '🤔', '🙄', '😴', '🤯', '😱', '🥶', '🥵', '😡', '🤡', '👻', '💀', '🤖', '👽', '😈'] },
  { id: 'hands', icon: '👍', label: 'Hands', items: ['👍', '👎', '👏', '🙌', '🙏', '🤝', '💪', '✌️', '🤞', '🤟', '👌', '🫶', '👋', '🤙', '☝️', '✊'] },
  { id: 'love', icon: '❤️', label: 'Love', items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💕', '💞', '💖', '💘', '😻', '💋', '🌹'] },
  { id: 'fun', icon: '🔥', label: 'Fun', items: ['🔥', '🎉', '🎊', '✨', '💯', '⚡', '🚀', '🏆', '🎂', '🎁', '🍕', '🍔', '🍟', '🍺', '☕', '⚽', '🎮', '🎵', '🌈', '🌍', '🐶', '🐱', '🦁', '🐸'] },
];

export const EMOJI_GRID = [
  ...new Set([
    ...'😀😃😄😁😆😅😂🤣🙂🙃😉😊😇🥰😍🤩😘😗😚😙😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬😮‍💨🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵🤯🤠🥳😎🤓🧐😕😟🙁☹️😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠️💩🤡👹👺👻👽🤖'.match(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu),
    ...'👋🤚🖐✋🖖👌🤌🤏✌️🤞🤟🤘🤙👈👉👆👇☝️👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏💪❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝🔥✨⭐🌟💫🎉🎊🎈🎁🏆🥇⚽🏀🎮🎵🎶🍕🍔🍟🌭🍿🍩🍪🎂☕🍺🍷🌹🌸☀️🌙⭐🌈☁️⚡❄️🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🚀✈️🚗🏠💰📱💻📷🔒🔑💡'.match(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu),
  ]),
];

const key = (uid) => `atomshade.stickers.${uid}`;
export const MAX_MY_STICKERS = 24;

export function loadMyStickers(uid) {
  try {
    const v = JSON.parse(localStorage.getItem(key(uid)) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.startsWith('data:image/')).slice(0, MAX_MY_STICKERS) : [];
  } catch {
    return [];
  }
}
export function saveMyStickers(uid, list) {
  try {
    localStorage.setItem(key(uid), JSON.stringify(list.slice(0, MAX_MY_STICKERS)));
    return true;
  } catch {
    return false; // storage full
  }
}

// Shrinks a picture into a small square sticker (a data: link kept on this device).
export async function makeSticker(file) {
  const bmp = await createImageBitmap(file);
  const side = 256;
  const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const url = c.toDataURL('image/webp', 0.85);
  if (!url.startsWith('data:image/')) throw new Error('Could not read that picture');
  return url;
}

export async function dataUrlToBlob(url) {
  const r = await fetch(url);
  return r.blob();
}

// GIF search (optional): needs a free Giphy key in NEXT_PUBLIC_GIPHY_KEY. Without it the GIF tab is hidden.
export const GIPHY_KEY = process.env.NEXT_PUBLIC_GIPHY_KEY || '';
export async function searchGifs(q) {
  const base = 'https://api.giphy.com/v1/gifs/';
  const url = q ? `${base}search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13` : `${base}trending?api_key=${GIPHY_KEY}&limit=24&rating=pg-13`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('GIF search is not available right now');
  const j = await r.json();
  return (j.data || []).map((g) => ({ id: g.id, preview: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url, url: g.images?.downsized?.url || g.images?.original?.url })).filter((g) => g.preview && g.url);
}
