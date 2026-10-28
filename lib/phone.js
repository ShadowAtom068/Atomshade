// Phone numbers are stored as digits only, with the country code (e.g. 2348012345678).
export function cleanPhone(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  return d;
}

// People type numbers different ways: 0801..., +234801..., 234801...
// Comparing the last 10 digits makes all of those match.
export function phoneKey(input) {
  return cleanPhone(input).slice(-10);
}

export function phoneMatches(stored, typed) {
  const t = cleanPhone(typed);
  if (t.length < 4 || !stored) return false;
  if (stored.includes(t.replace(/^0+/, ''))) return true;
  return t.length >= 7 && phoneKey(stored) === phoneKey(t);
}

export function prettyPhone(stored) {
  return stored ? `+${stored}` : '';
}
