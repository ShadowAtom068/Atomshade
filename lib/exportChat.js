import { supabase } from './supabase';
import { describeMessage } from './extras';

const pad = (n) => String(n).padStart(2, '0');
const stamp = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const safeName = (s) => (String(s || 'chat').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'chat');

// One readable line per message. textOf gives the readable text of a message (secret chats pass their decrypted text).
export function chatToText(title, messages, nameOf, textOf) {
  const lines = [`Atomshade chat with ${title}`, `Saved ${stamp(new Date().toISOString())}`, 'Photos, videos, voice notes and documents are listed by name only.', ''];
  for (const m of messages) {
    if (m.deleted_for_everyone) continue;
    if (m.deliver_at && new Date(m.deliver_at).getTime() > Date.now()) continue; // a time capsule that has not opened yet
    const t = describeMessage(m, textOf(m));
    const extra = m.meta?.t === 'location' ? ` (${m.meta.lat}, ${m.meta.lng})` : m.meta?.t === 'poll' ? ` [${(m.meta.options || []).join(' / ')}]` : '';
    lines.push(`[${stamp(m.sort_at || m.created_at)}] ${nameOf(m)}: ${t}${extra}${m.edited_at ? ' (edited)' : ''}`);
  }
  return lines.join('\n') + '\n';
}

export function downloadText(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Reads up to `max` messages of a (normal) chat, oldest first.
// Everything for the Settings backup: one text file with every normal chat.
export async function backupAllChats(meId, onProgress) {
  const { data: list, error } = await supabase.rpc('my_chat_list');
  if (error || !Array.isArray(list)) throw new Error('Could not read your chats.');
  const normal = list.filter((c) => !c.secret);
  const parts = [`Atomshade backup · ${stamp(new Date().toISOString())}\nNormal chats only. Secret chats are not in this file: open one and use ⋮ → Export chat.\n`];
  let i = 0;
  for (const c of normal) {
    i += 1;
    if (onProgress) onProgress(i, normal.length, c.title);
    const msgs = await fetchAllMessages(c.conversation_id, 3000);
    const ids = [...new Set(msgs.map((m) => m.sender_id))];
    const names = {};
    if (ids.length) {
      const { data: ppl } = await supabase.from('profiles').select('id, name').in('id', ids);
      (ppl || []).forEach((p) => { names[p.id] = p.name; });
    }
    parts.push('\n==============================\n' + chatToText(c.title, msgs, (m) => (m.sender_id === meId ? 'You' : names[m.sender_id] || c.real_title || c.title), (m) => m.body || ''));
  }
  return { text: parts.join(''), count: normal.length };
}

export async function fetchAllMessages(convId, max = 5000) {
  const out = [];
  let before = null;
  while (out.length < max) {
    let q = supabase.from('messages').select('*').eq('conversation_id', convId).order('sort_at', { ascending: false }).limit(500);
    if (before) q = q.lt('sort_at', before);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || !data.length) break;
    out.push(...data);
    before = data[data.length - 1].sort_at;
    if (data.length < 500) break;
  }
  return out.reverse();
}
