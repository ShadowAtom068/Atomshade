// Vibes: a mood that shows next to your name and fades by itself.
export const VIBES = [
  { id: 'free', icon: '🟢', label: 'Free to talk' },
  { id: 'busy', icon: '🔴', label: 'Busy' },
  { id: 'sleeping', icon: '😴', label: 'Sleeping' },
  { id: 'studying', icon: '📚', label: 'Studying' },
  { id: 'out', icon: '🚶', label: 'Out and about' },
  { id: 'need_laugh', icon: '😂', label: 'Need a laugh' },
  { id: 'gaming', icon: '🎮', label: 'Gaming' },
  { id: 'music', icon: '🎧', label: 'In my music' },
];

export function vibeOf(id, until) {
  if (!id) return null;
  if (until && new Date(until).getTime() <= Date.now()) return null;
  return VIBES.find((v) => v.id === id) || null;
}
