'use client';
import { useEffect, useState } from 'react';

// Settings that belong to THIS device (look and feel, data use). Kept in the browser, not the database.
const KEY = 'atomshade.prefs';
export const DEFAULT_PREFS = {
  theme: 'dark', // 'dark' | 'light' | 'system'
  wallpaper: 'default', // see WALLPAPERS
  fontSize: 'normal', // 'normal' | 'large'
  autoImages: true, // false = tap to download photos
  autoVideos: true, // false = tap to download videos
};

export const WALLPAPERS = [
  { id: 'default', label: 'Atomshade' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'ember', label: 'Ember' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'plain', label: 'Plain' },
];

export function getPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULT_PREFS, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function applyPrefs(p = getPrefs()) {
  const root = document.documentElement;
  const dark = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true;
  const theme = p.theme === 'system' ? (dark ? 'dark' : 'light') : p.theme === 'light' ? 'light' : 'dark';
  root.dataset.theme = theme;
  root.dataset.font = p.fontSize === 'large' ? 'large' : 'normal';
  root.dataset.wallpaper = WALLPAPERS.some((w) => w.id === p.wallpaper) ? p.wallpaper : 'default';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f4fb' : '#0a0a14');
}

export function setPref(field, value) {
  if (!(field in DEFAULT_PREFS)) return;
  const next = { ...getPrefs(), [field]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: the change still applies until the page is closed */
  }
  applyPrefs(next);
  window.dispatchEvent(new CustomEvent('atomshade-prefs', { detail: next }));
}

export function usePrefs() {
  const [p, setP] = useState(DEFAULT_PREFS);
  useEffect(() => {
    setP(getPrefs());
    const on = (e) => setP(e.detail || getPrefs());
    window.addEventListener('atomshade-prefs', on);
    return () => window.removeEventListener('atomshade-prefs', on);
  }, []);
  return p;
}
