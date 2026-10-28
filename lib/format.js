// Small helpers used across screens.

export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function clockTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function initials(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

// Gives every person a stable avatar colour (purple / blue / red family).
const AVATAR_COLORS = ['#7c3aed', '#4f46e5', '#1d4ed8', '#be123c', '#a21caf', '#6d28d9', '#dc2626'];
export function avatarColor(seed) {
  const s = seed || '?';
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// Lighter colours for sender names inside group chats (readable on dark bubbles).
const NAME_COLORS = ['#c4b5fd', '#93c5fd', '#fca5a5', '#f0abfc', '#a5b4fc', '#fdba74', '#86efac'];
export function nameColor(seed) {
  const s = seed || '?';
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return NAME_COLORS[hash % NAME_COLORS.length];
}

// Turns what a person types into +countrycode format.
// Numbers starting with 0 are treated as Nigerian (+234).
export function normalizePhone(raw) {
  const p = raw.replace(/[\s()-]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return '+' + p.slice(2);
  if (p.startsWith('0')) return '+234' + p.slice(1);
  return '+' + p;
}
