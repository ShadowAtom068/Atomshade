// The Atomshade logo: an atom with three orbits, glowing purple to red.
// Use it anywhere with:  <AtomLogo size={40} />
export default function AtomLogo({ size = 40, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      style={{ filter: 'drop-shadow(0 0 8px rgba(124, 58, 237, 0.55))', flexShrink: 0 }}
      aria-label="Atomshade"
      role="img"
    >
      <defs>
        <linearGradient id="atomGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#atomGrad)" strokeWidth="3">
        <ellipse cx="32" cy="32" rx="26" ry="10" />
        <ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(60 32 32)" />
        <ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(120 32 32)" />
      </g>
      <circle cx="58" cy="32" r="3" fill="#e9d5ff" />
      <circle cx="19" cy="9.5" r="3" fill="#e9d5ff" />
      <circle cx="19" cy="54.5" r="3" fill="#e9d5ff" />
      <circle cx="32" cy="32" r="7" fill="#ef4444" />
      <circle cx="30" cy="30" r="2" fill="#fecaca" />
    </svg>
  );
}
