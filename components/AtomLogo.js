// The Atomshade logo: an atom with three orbits. Flat, single colour (follows the theme accent).
// Use it anywhere with:  <AtomLogo size={40} />
export default function AtomLogo({ size = 40, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      style={{ flexShrink: 0, color: 'var(--purple-soft)' }}
      aria-label="Atomshade"
      role="img"
    >
      <g fill="none" stroke="currentColor" strokeWidth="3">
        <ellipse cx="32" cy="32" rx="26" ry="10" />
        <ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(60 32 32)" />
        <ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(120 32 32)" />
      </g>
      <circle cx="58" cy="32" r="3" fill="currentColor" />
      <circle cx="19" cy="9.5" r="3" fill="currentColor" />
      <circle cx="19" cy="54.5" r="3" fill="currentColor" />
      <circle cx="32" cy="32" r="6.5" fill="currentColor" />
    </svg>
  );
}
