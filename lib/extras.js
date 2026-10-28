// Small helpers for documents, locations, polls and reactions.

export const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏'];

// File type -> what the database accepts (must match update-whatsapp-extras.sql).
export const DOC_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
};
export const DOC_ACCEPT = Object.keys(DOC_TYPES).map((e) => '.' + e).join(',');
export const MAX_DOC_BYTES = 50 * 1024 * 1024;

export function docInfo(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mime = DOC_TYPES[ext];
  return mime ? { ext, mime } : null;
}

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function docIcon(name = '') {
  const e = name.split('.').pop().toLowerCase();
  if (e === 'pdf') return '📕';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(e)) return '📗';
  if (['ppt', 'pptx'].includes(e)) return '📙';
  if (e === 'zip') return '🗜️';
  return '📄';
}

export const osmLink = (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
export const googleLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

// Is this a normal text message (no document, location or poll)?
export const isPlainText = (m) => m.kind === 'text' && !m.meta && !m.media_path;

// Escape % _ and \ so a search word is matched literally by ILIKE.
export const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

// One line that describes any message (reply bar, forwarded preview).
export function describeMessage(m, text) {
  if (m.deleted_for_everyone) return 'Message deleted';
  if (m.view_once) return m.kind === 'video' ? '🎥 View once video' : '📷 View once photo';
  if (m.kind === 'image') return '📷 Photo';
  if (m.kind === 'video') return '🎥 Video';
  if (m.kind === 'audio') return '🎤 Voice note';
  if (m.meta?.t === 'file') return `📄 ${m.meta.name}`;
  if (m.meta?.t === 'location') return '📍 Location';
  if (m.meta?.t === 'poll') return `📊 ${m.meta.q}`;
  if (m.meta?.t === 'sticker') return `${m.meta.s} Sticker`;
  return text;
}
