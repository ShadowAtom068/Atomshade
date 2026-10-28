// Atomshade push function. The database calls it when a message, a time capsule or a call needs
// to reach someone. It never shows secret-chat text: secret messages only say "Secret message".
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// The secret and signing keys live in the locked push_config table (read once per cold start).
let config: { secret: string } | null = null;
async function loadConfig() {
  if (config) return config;
  const { data } = await db.from('push_config').select('secret, vapid_public, vapid_private').eq('id', 1).maybeSingle();
  if (!data) return null;
  webpush.setVapidDetails('mailto:support@atomshade.app', data.vapid_public, data.vapid_private);
  config = { secret: data.secret };
  return config;
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

async function deliver(userIds: string[], payload: Record<string, unknown>) {
  if (!userIds.length) return 0;
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', userIds);
  let sent = 0;
  await Promise.all(
    (subs || []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: payload.type === 'call' ? 45 : 86400, urgency: payload.type === 'call' ? 'high' : 'normal' },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
      }
    }),
  );
  return sent;
}

async function onMessage(id: string) {
  const { data: m } = await db
    .from('messages')
    .select('id, conversation_id, sender_id, kind, body, e2ee, deleted_for_everyone, deliver_at, meta')
    .eq('id', id)
    .maybeSingle();
  if (!m || m.deleted_for_everyone) return 0;
  if (m.deliver_at && new Date(m.deliver_at).getTime() > Date.now() + 5000) return 0; // not open yet
  const [{ data: conv }, { data: members }, { data: sender }] = await Promise.all([
    db.from('conversations').select('is_group, name, secret').eq('id', m.conversation_id).maybeSingle(),
    db.from('conversation_members').select('user_id').eq('conversation_id', m.conversation_id),
    db.from('profiles').select('name').eq('id', m.sender_id).maybeSingle(),
  ]);
  let to = (members || []).map((x) => x.user_id as string).filter((u) => u !== m.sender_id);
  // People who blocked the sender hear nothing.
  const { data: blocks } = await db.from('user_blocks').select('blocker_id').eq('blocked_id', m.sender_id).in('blocker_id', to.length ? to : ['00000000-0000-0000-0000-000000000000']);
  const blockedBy = new Set((blocks || []).map((b) => b.blocker_id as string));
  to = to.filter((u) => !blockedBy.has(u));
  // People who muted this chat hear nothing (calls are never muted).
  if (to.length) {
    const { data: muted } = await db.from('chat_prefs').select('user_id, muted_until').eq('conversation_id', m.conversation_id).in('user_id', to);
    const quiet = new Set((muted || []).filter((p) => p.muted_until && new Date(p.muted_until).getTime() > Date.now()).map((p) => p.user_id as string));
    to = to.filter((u) => !quiet.has(u));
  }
  const who = sender?.name || 'Someone';
  let text: string;
  if (m.e2ee || conv?.secret) text = '🔒 Secret message';
  else if (m.kind === 'image') text = '📷 Photo';
  else if (m.kind === 'video') text = '🎥 Video';
  else if (m.kind === 'audio') text = '🎤 Voice note';
  else if (m.meta?.t === 'poll') text = '📊 Poll: ' + clip(String(m.meta.q || ''), 70);
  else if (m.meta?.t === 'location') text = '📍 Location';
  else if (m.meta?.t === 'file') text = '📄 ' + clip(String(m.meta.name || 'Document'), 80);
  else text = clip(String(m.body || 'New message'), 90);
  const title = conv?.is_group ? `${who} · ${conv?.name || 'Group'}` : who;
  return deliver(to, { type: 'message', title, body: text, conv: m.conversation_id, tag: `chat-${m.conversation_id}` });
}

async function onCall(id: string) {
  const { data: c } = await db.from('calls').select('id, caller_id, callee_id, media, status, created_at').eq('id', id).maybeSingle();
  if (!c || c.status !== 'ringing') return 0;
  const { data: blocked } = await db.from('user_blocks').select('blocker_id').eq('blocker_id', c.callee_id).eq('blocked_id', c.caller_id).maybeSingle();
  if (blocked) return 0;
  const { data: caller } = await db.from('profiles').select('name').eq('id', c.caller_id).maybeSingle();
  return deliver([c.callee_id], {
    type: 'call',
    title: `${caller?.name || 'Someone'} is calling…`,
    body: c.media === 'video' ? 'Video call. Tap to answer.' : 'Voice call. Tap to answer.',
    tag: `call-${c.id}`,
  });
}

// A group call started: ring everyone else in the group (calls are never muted).
async function onGroupCall(id: string) {
  const { data: c } = await db.from('group_calls').select('id, conversation_id, started_by, media, status').eq('id', id).maybeSingle();
  if (!c || c.status !== 'active') return 0;
  const [{ data: conv }, { data: members }, { data: starter }] = await Promise.all([
    db.from('conversations').select('name, is_group, secret').eq('id', c.conversation_id).maybeSingle(),
    db.from('conversation_members').select('user_id').eq('conversation_id', c.conversation_id),
    db.from('profiles').select('name').eq('id', c.started_by).maybeSingle(),
  ]);
  if (!conv?.is_group || conv.secret) return 0;
  let to = (members || []).map((x) => x.user_id as string).filter((u) => u !== c.started_by);
  const { data: blocks } = await db.from('user_blocks').select('blocker_id').eq('blocked_id', c.started_by).in('blocker_id', to.length ? to : ['00000000-0000-0000-0000-000000000000']);
  const blockedBy = new Set((blocks || []).map((b) => b.blocker_id as string));
  to = to.filter((u) => !blockedBy.has(u));
  return deliver(to, {
    type: 'call',
    title: `${starter?.name || 'Someone'} started a group ${c.media === 'video' ? 'video' : 'voice'} call`,
    body: `${conv?.name || 'Group'} · Tap to join`,
    conv: c.conversation_id,
    tag: `gcall-${c.id}`,
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const cfg = await loadConfig();
  if (!cfg || !safeEqual(req.headers.get('x-push-secret') || '', cfg.secret)) {
    return new Response('Forbidden', { status: 403 });
  }
  try {
    const { type, id } = await req.json();
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return new Response('Bad request', { status: 400 });
    let sent = 0;
    if (type === 'message') sent = await onMessage(id);
    else if (type === 'call') sent = await onCall(id);
    else if (type === 'gcall') sent = await onGroupCall(id);
    else return new Response('Bad request', { status: 400 });
    return Response.json({ ok: true, sent });
  } catch (e) {
    console.error('push failed', e);
    return Response.json({ ok: false }, { status: 500 });
  }
});
