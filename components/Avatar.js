import { avatarColor, initials } from '../lib/format';

export default function Avatar({ name, seed, online, small }) {
  return (
    <div className={`avatar ${small ? 'small' : ''}`} style={{ background: avatarColor(seed || name) }}>
      {initials(name)}
      {online && <span className="online-dot" />}
    </div>
  );
}
