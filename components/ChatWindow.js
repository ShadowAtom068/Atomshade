'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { clockTime, nameColor } from '../lib/format';
import { compressImage, copyMedia, formatDuration, uploadMedia } from '../lib/media';
import Avatar from './Avatar';
import GroupInfo from './GroupInfo';
import { openSecretChat, trustPeer, encrypt, decrypt } from '../lib/secret';
import { MAX_SECRET_CHARS } from '../lib/e2ee';
import { AudioMessage, ImageMessage, VideoMessage } from './MediaMessage';
import VideoEditor from './VideoEditor';
import MediaEditor from './MediaEditor';
import { usePrefs } from '../lib/prefs';
import { chatToText, downloadText, fetchAllMessages, safeName } from '../lib/exportChat';
import { DOC_ACCEPT, MAX_DOC_BYTES, describeMessage, docInfo, isPlainText, likeEscape } from '../lib/extras';
import StickerPanel from './StickerPanel';
import { dataUrlToBlob } from '../lib/stickers';
import { AttachMenu, FileMessage, ForwardModal, LocationMessage, PollMessage, PollModal, ReactionPicker, ReactionRow, ViewOnceMessage } from './MessageExtras';

const MAX_VOICE_MS = 3 * 60 * 1000; // voice notes stop by themselves after 3 minutes
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const LOCKED_TEXT = '🔒 This message cannot be opened on this device';

// Time capsules appear in the order they were opened, not the order they were written.
const sortKey = (m) => new Date(m.sort_at || m.deliver_at || m.created_at).getTime();
const bySort = (a, b) => sortKey(a) - sortKey(b);
const isPending = (m) => !!m.deliver_at && new Date(m.deliver_at).getTime() > Date.now();
const isExpired = (m) => !!m.expires_at && new Date(m.expires_at).getTime() <= Date.now();
const DISAPPEAR_CHOICES = [
  [null, 'Off'],
  [86400, '24 hours'],
  [604800, '7 days'],
  [7776000, '90 days'],
];
const disappearLabel = (s) => (DISAPPEAR_CHOICES.find(([v]) => v === s) || [0, ''])[1];

function localInput(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

function Ticks({ message, isGroup }) {
  // In groups we only show "sent". In 1-on-1 chats: sent, delivered, read.
  if (isGroup) return <span className="tick">✓</span>;
  if (message.read_at) return <span className="tick read">✓✓</span>;
  if (message.delivered_at) return <span className="tick">✓✓</span>;
  return <span className="tick">✓</span>;
}

const ClipIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3" />
  </svg>
);
const MicIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export default function ChatWindow({ me, chat, online, onBack, onLeft, onCall, callBusy, keyState, onNeedKeys, onChatAction, onChanged, forwardTargets, onGroupCall, onJoinGroupCall }) {
  const convId = chat.conversation_id;
  const isGroup = chat.is_group;
  const isSecret = !!chat.secret;

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [typingName, setTypingName] = useState(null);
  const [members, setMembers] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const [lightbox, setLightbox] = useState(null);
  const [editFile, setEditFile] = useState(null);
  const [editVideo, setEditVideo] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [capsuleAt, setCapsuleAt] = useState(null); // null = send now, string = datetime-local value
  const [ctx, setCtx] = useState(null); // secret chat: { key, pinStatus, code, peerPublic }
  const [ctxError, setCtxError] = useState('');
  const [plain, setPlain] = useState({}); // decrypted text by message id (null = could not open)
  const [showSafety, setShowSafety] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [, forceTick] = useState(0);
  const prefs = usePrefs();
  const [disappear, setDisappear] = useState(null); // seconds, or null = off
  const [showDisappear, setShowDisappear] = useState(false);
  const [disappearBusy, setDisappearBusy] = useState(false);
  const [disappearError, setDisappearError] = useState('');
  const [stars, setStars] = useState(null); // Set of starred message ids, or null if stars are not available
  const [reactions, setReactions] = useState({}); // { messageId: { userId: emoji } }
  const [votes, setVotes] = useState({}); // { messageId: { userId: [choice, ...] } }
  const [onceMine, setOnceMine] = useState(() => new Set()); // view-once messages I have opened
  const [onceCount, setOnceCount] = useState({}); // for my view-once messages: how many people opened
  const [pickerFor, setPickerFor] = useState(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [liveCall, setLiveCall] = useState(null); // the group call going on now: { call_id, media, participants }
  const [showStickers, setShowStickers] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [editing, setEditing] = useState(null);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [anchor, setAnchor] = useState(false); // true while looking at old messages found by search
  const [jumpTarget, setJumpTarget] = useState(null);
  const [flash, setFlash] = useState(null);

  const bottomRef = useRef(null);
  const channelRef = useRef(null);
  const lastTypingSent = useRef(0);
  const typingTimer = useRef(null);
  const fileRef = useRef(null);
  const docRef = useRef(null);
  const onceNext = useRef(false); // the next photo/video is sent as view once
  const anchorRef = useRef(false);
  const recRef = useRef(null); // the active recording: { rec, stream, mime, startedAt, chunks }

  // Tell the database this chat has been read (clears the badge, blue ticks in 1-on-1 chats).
  const markRead = useCallback(() => {
    supabase.rpc('mark_conversation_read', { conv: convId }).then(() => {});
  }, [convId]);

  // Names of the people in a group, to label their messages.
  const messagesById = useMemo(() => Object.fromEntries(messages.map((m) => [m.id, m])), [messages]);

  const memberNames = useMemo(() => {
    const map = {};
    members.forEach((m) => {
      if (m.profiles) map[m.user_id] = m.profiles.name;
    });
    return map;
  }, [members]);

  useEffect(() => {
    if (!isGroup) return;
    supabase
      .from('conversation_members')
      .select('user_id, role, profiles(id, name)')
      .eq('conversation_id', convId)
      .then(({ data }) => setMembers(data || []));
  }, [convId, isGroup, showInfo]);

  // Reactions, poll votes and "view once" opens for this chat.
  const loadExtras = useCallback(() => {
    supabase
      .from('message_reactions')
      .select('message_id, user_id, emoji')
      .eq('conversation_id', convId)
      .not('emoji', 'is', null)
      .limit(5000)
      .then(({ data, error }) => {
        if (error || !data) return;
        const map = {};
        data.forEach((r) => {
          (map[r.message_id] = map[r.message_id] || {})[r.user_id] = r.emoji;
        });
        setReactions(map);
      });
    supabase
      .from('poll_votes')
      .select('message_id, user_id, choices')
      .eq('conversation_id', convId)
      .limit(5000)
      .then(({ data, error }) => {
        if (error || !data) return;
        const map = {};
        data.forEach((r) => {
          (map[r.message_id] = map[r.message_id] || {})[r.user_id] = r.choices || [];
        });
        setVotes(map);
      });
    supabase
      .from('view_once_views')
      .select('message_id, user_id')
      .limit(5000)
      .then(({ data, error }) => {
        if (error || !data) return;
        const mine = new Set();
        const counts = {};
        data.forEach((r) => {
          if (r.user_id === me.id) mine.add(r.message_id);
          else counts[r.message_id] = (counts[r.message_id] || 0) + 1;
        });
        setOnceMine(mine);
        setOnceCount(counts);
      });
  }, [convId, me.id]);

  useEffect(() => {
    let cancelled = false;

    anchorRef.current = false;
    setAnchor(false);
    setReactions({});
    setVotes({});
    setOnceMine(new Set());
    setOnceCount({});
    loadExtras();
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('sort_at', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (cancelled) return;
        setMessages((data || []).reverse());
        markRead();
      });

    // Time capsules open without any live event, so look again every 30 seconds.
    const refetch = setInterval(() => {
      if (document.visibilityState === 'hidden' || anchorRef.current) return;
      loadExtras();
      supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('sort_at', { ascending: false })
        .limit(200)
        .then(({ data }) => {
          if (cancelled || !data) return;
          setMessages(data.slice().reverse());
          forceTick((n) => n + 1);
          markRead();
        });
    }, 30000);

    const channel = supabase
      .channel(`chat:${convId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const m = payload.new;
          if (!anchorRef.current) setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].sort(bySort)));
          if (m.sender_id !== me.id) {
            setTypingName(null);
            markRead();
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const m = payload.new;
          setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
          if (m.e2ee) {
            // an edited secret message must be opened again
            setPlain((prev) => {
              if (!(m.id in prev)) return prev;
              const next = { ...prev };
              delete next[m.id];
              return next;
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions', filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const r = payload.new;
          if (!r || !r.message_id) return;
          setReactions((prev) => {
            const cur = { ...(prev[r.message_id] || {}) };
            if (r.emoji) cur[r.user_id] = r.emoji;
            else delete cur[r.user_id];
            return { ...prev, [r.message_id]: cur };
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'poll_votes', filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const r = payload.new;
          if (!r || !r.message_id) return;
          setVotes((prev) => ({ ...prev, [r.message_id]: { ...(prev[r.message_id] || {}), [r.user_id]: r.choices || [] } }));
        }
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.user !== me.id) {
          setTypingName(payload.name || 'Someone');
          clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTypingName(null), 2500);
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      clearInterval(refetch);
      clearTimeout(typingTimer.current);
      supabase.removeChannel(channel);
    };
  }, [convId, me.id, markRead, loadExtras]);

  // Always scroll to the newest message
  const lastMessageId = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (anchorRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lastMessageId, typingName]);

  // Jump to a message found by search.
  useEffect(() => {
    if (!jumpTarget) return undefined;
    const el = document.querySelector(`[data-mid="${jumpTarget}"]`);
    if (!el) return undefined;
    el.scrollIntoView({ block: 'center' });
    setFlash(jumpTarget);
    setJumpTarget(null);
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [jumpTarget, messages]);

  // If you leave the chat while recording, throw the recording away and release the microphone.
  useEffect(() => {
    return () => {
      const r = recRef.current;
      if (r) {
        recRef.current = null;
        r.rec.onstop = null;
        r.stream.getTracks().forEach((t) => t.stop());
        try {
          r.rec.stop();
        } catch (e) {
          /* already stopped */
        }
      }
    };
  }, []);

  function addMessage(m) {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].sort(bySort)));
  }

  // ----- Secret chats: get the keys, then open messages as they arrive -----
  useEffect(() => {
    if (!isSecret || keyState !== 'ready') return undefined;
    let cancelled = false;
    setCtxError('');
    openSecretChat(me.id, convId, chat.other_id)
      .then(async (r) => {
        if (cancelled) return;
        if (r.pinStatus === 'new') {
          await trustPeer(me.id, chat.other_id, r.peerPublic); // first time: remember this person's key
          r.pinStatus = 'same';
          r.first = true;
        }
        if (!cancelled) setCtx(r);
      })
      .catch((err) => !cancelled && setCtxError(err.message || 'Could not open this secret chat'));
    return () => {
      cancelled = true;
    };
  }, [isSecret, keyState, me.id, convId, chat.other_id]);

  useEffect(() => {
    if (!ctx?.key) return;
    const todo = messages.filter((m) => m.e2ee && !m.deleted_for_everyone && m.body && !(m.id in plain));
    if (!todo.length) return;
    let cancelled = false;
    Promise.all(todo.map(async (m) => [m.id, await decrypt(ctx.key, m.body, `${convId}|${m.sender_id}`)])).then((pairs) => {
      if (cancelled) return;
      setPlain((prev) => {
        const next = { ...prev };
        pairs.forEach(([id, t]) => {
          next[id] = t;
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [messages, ctx, convId, plain]);

  // Is this person blocked by me?
  useEffect(() => {
    if (isGroup || !chat.other_id) return;
    supabase
      .from('user_blocks')
      .select('blocked_id')
      .eq('blocked_id', chat.other_id)
      .then(({ data }) => setBlocked(!!(data && data.length)));
  }, [isGroup, chat.other_id]);

  // The chat's disappearing-messages timer (looked at again with every refresh).
  const loadDisappear = useCallback(() => {
    supabase
      .from('conversations')
      .select('disappear_secs')
      .eq('id', convId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) setDisappear(data.disappear_secs || null);
      });
  }, [convId]);
  useEffect(() => {
    loadDisappear();
    const id = setInterval(() => document.visibilityState !== 'hidden' && loadDisappear(), 30000);
    return () => clearInterval(id);
  }, [loadDisappear]);

  // Is a group call going on in this group right now?
  useEffect(() => {
    if (!isGroup) return undefined;
    let off = false;
    const look = () => {
      if (document.visibilityState === 'hidden') return;
      supabase.rpc('active_group_call', { p_conv: convId }).then(({ data, error }) => {
        if (off || error) return;
        setLiveCall(Array.isArray(data) && data[0] ? data[0] : null);
      });
    };
    look();
    const id = setInterval(look, 8000);
    return () => {
      off = true;
      clearInterval(id);
    };
  }, [isGroup, convId, callBusy]);

  // Which messages did I star?
  useEffect(() => {
    if (isSecret) {
      setStars(null);
      return;
    }
    let off = false;
    supabase
      .from('starred_messages')
      .select('message_id')
      .limit(2000)
      .then(({ data, error }) => {
        if (off) return;
        setStars(error ? null : new Set((data || []).map((r) => r.message_id)));
      });
    return () => {
      off = true;
    };
  }, [convId, isSecret]);

  // Messages with a disappear time vanish on screen the moment their time is up.
  const anyExpiring = messages.some((m) => m.expires_at);
  useEffect(() => {
    if (!anyExpiring) return undefined;
    const id = setInterval(() => forceTick((n) => n + 1), 10000);
    return () => clearInterval(id);
  }, [anyExpiring]);

  async function toggleStar(m) {
    if (!stars) return;
    const has = stars.has(m.id);
    const next = new Set(stars);
    if (has) next.delete(m.id);
    else next.add(m.id);
    setStars(next);
    const { error } = has
      ? await supabase.from('starred_messages').delete().eq('message_id', m.id)
      : await supabase.from('starred_messages').insert({ message_id: m.id });
    if (error) {
      setStars(stars);
      alert(has ? 'Could not remove the star. If this keeps happening, run update-settings-delete.sql in Supabase.' : 'Could not star this message: ' + error.message);
    }
  }

  async function saveDisappear(secs) {
    setDisappearBusy(true);
    setDisappearError('');
    const { error } = await supabase.rpc('set_disappearing', { p_conv: convId, p_secs: secs });
    setDisappearBusy(false);
    if (error) {
      setDisappearError(error.code === 'PGRST202' ? 'This needs the latest database update (update-settings.sql).' : error.message);
      return;
    }
    setDisappear(secs);
    setShowDisappear(false);
  }

  const myRole = members.find((x) => x.user_id === me.id)?.role;
  const canSetDisappear = !isGroup || myRole === 'admin';

  const textOf = (m) => {
    if (m.deleted_for_everyone) return '';
    if (!m.e2ee) return m.body || '';
    if (!(m.id in plain)) return '…';
    return plain[m.id] === null ? LOCKED_TEXT : plain[m.id];
  };
  const previewOfMsg = (m) => describeMessage(m, textOf(m));

  async function acceptNewKey() {
    if (!ctx) return;
    await trustPeer(me.id, chat.other_id, ctx.peerPublic);
    setCtx({ ...ctx, pinStatus: 'same' });
  }

  async function blockToggle() {
    setMenuOpen(false);
    if (blocked) {
      const { error } = await supabase.rpc('unblock_user', { p_user: chat.other_id });
      if (error) alert(error.message);
      else setBlocked(false);
      return;
    }
    if (!confirm(`Block ${chat.title}? They will not be able to message or call you.`)) return;
    const { error } = await supabase.rpc('block_user', { p_user: chat.other_id });
    if (error) alert(error.code === 'PGRST202' ? 'Blocking is not set up yet. Run update-security.sql in Supabase.' : error.message);
    else setBlocked(true);
  }

  async function reportUser() {
    setMenuOpen(false);
    const reason = prompt(`Why are you reporting ${chat.title}? (optional)`);
    if (reason === null) return;
    const { error } = await supabase.rpc('report_user', { p_user: chat.other_id, p_reason: reason.slice(0, 500) });
    alert(error ? error.message : 'Reported. Thank you. Atomshade moderators will take a look.');
  }

  async function reportMessage(m) {
    const note = isSecret
      ? 'Report this message? Because this is a secret chat, your phone will send the readable text of THIS message to Atomshade moderators.'
      : 'Report this message to Atomshade moderators?';
    if (!confirm(note)) return;
    const reason = prompt('What is wrong with it? (optional)');
    if (reason === null) return;
    const { error } = await supabase.rpc('report_message', {
      p_message: m.id,
      p_reason: reason.slice(0, 500),
      p_plaintext: m.e2ee ? textOf(m) : null,
    });
    alert(error ? error.message : 'Reported. Thank you.');
  }

  function onType(e) {
    setText(e.target.value);
    const now = Date.now();
    if (now - lastTypingSent.current > 1500 && channelRef.current) {
      lastTypingSent.current = now;
      channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { user: me.id, name: me.name } });
    }
  }

  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    if (editing) return saveEdit(body);
    const row = { conversation_id: convId, kind: 'text', body, reply_to: replyTo?.id || null };

    if (capsuleAt !== null) {
      const when = new Date(capsuleAt);
      const ms = when.getTime() - Date.now();
      if (!capsuleAt || Number.isNaN(ms) || ms < 60 * 1000) {
        alert('Pick a time at least a minute from now.');
        return;
      }
      if (ms > 365 * 24 * 3600 * 1000) {
        alert('A time capsule can open up to one year from now.');
        return;
      }
      row.deliver_at = when.toISOString();
    }

    if (isSecret) {
      if (!ctx?.key || ctx.pinStatus === 'changed') return;
      try {
        row.body = await encrypt(ctx.key, body, `${convId}|${me.id}`);
        row.e2ee = true;
      } catch (err) {
        alert(err.message);
        return;
      }
    }

    setText('');
    const { data, error } = await supabase.from('messages').insert(row).select().single();
    if (error) {
      setText(body);
      alert('Message not sent: ' + error.message);
    } else {
      if (isSecret) setPlain((prev) => ({ ...prev, [data.id]: body }));
      addMessage(data);
      setReplyTo(null);
      if (capsuleAt !== null) setCapsuleAt(null);
    }
  }

  async function deleteForEveryone(message) {
    if (!confirm(isPending(message) ? 'Cancel this time capsule?' : 'Delete this message for everyone?')) return;
    const { error } = await supabase.rpc('delete_message_for_everyone', { message_id: message.id });
    if (error) alert('Could not delete message: ' + error.message);
    else if (isPending(message)) setMessages((prev) => prev.filter((x) => x.id !== message.id));
  }

  // Shared by photos and voice notes: upload the file, then post a message that points to it.
  async function sendMedia({ kind, blob, ext, contentType, durationMs }) {
    const once = onceNext.current && (kind === 'image' || kind === 'video');
    onceNext.current = false;
    setUploading(true);
    try {
      const path = await uploadMedia(convId, blob, ext, contentType);
      const { data, error } = await supabase
        .from('messages')
        .insert({ conversation_id: convId, kind, media_path: path, duration_ms: durationMs ?? null, reply_to: replyTo?.id || null, ...(once ? { view_once: true } : {}) })
        .select()
        .single();
      if (error) throw error;
      addMessage(data);
      setReplyTo(null);
    } catch (err) {
      alert('Could not send: ' + (err.message || err));
    } finally {
      setUploading(false);
    }
  }

  async function onPickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type.startsWith('video/')) {
      if (file.size > 400 * 1024 * 1024) {
        alert('That video is too large. Please pick one under 400 MB.');
        return;
      }
      setEditVideo(file);
      return;
    }
    if (!file.type.startsWith('image/')) {
      alert('Please choose a photo or a video.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      alert('That photo is too large. Please pick one under 25 MB.');
      return;
    }
    // Normal photos open in the editor first. GIFs would lose their motion, so they go straight through.
    if (file.type === 'image/gif') return prepareAndSend(file);
    setEditFile(file);
  }

  async function prepareAndSend(file) {
    let blob = file;
    let ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    let contentType = file.type;
    try {
      blob = await compressImage(file);
      ext = 'jpg';
      contentType = 'image/jpeg';
    } catch (err) {
      // Could not shrink it, so send the original if it is small enough.
      if (file.size > 10 * 1024 * 1024) {
        alert('Could not prepare that photo. Try a different one.');
        return;
      }
    }
    sendMedia({ kind: 'image', blob, ext, contentType });
  }

  // ----- Documents, location, polls -----
  async function insertExtra(row) {
    const { data, error } = await supabase.from('messages').insert({ conversation_id: convId, kind: 'text', reply_to: replyTo?.id || null, ...row }).select().single();
    if (error) {
      alert('Could not send: ' + error.message);
      return false;
    }
    addMessage(data);
    setReplyTo(null);
    return true;
  }

  async function onPickDoc(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const info = docInfo(file);
    if (!info) {
      alert('That kind of file cannot be sent. You can send PDF, Word, Excel, PowerPoint, text, CSV, ZIP, RTF and OpenDocument files.');
      return;
    }
    if (file.size > MAX_DOC_BYTES) {
      alert('That document is too large. Please pick one under 50 MB.');
      return;
    }
    if (file.size === 0) {
      alert('That file is empty.');
      return;
    }
    setUploading(true);
    try {
      const path = await uploadMedia(convId, file, info.ext, info.mime);
      const name = file.name.slice(0, 150);
      await insertExtra({ body: `📄 ${name}`.slice(0, 200), media_path: path, meta: { t: 'file', name, size: file.size, mime: info.mime } });
    } catch (err) {
      alert('Could not send: ' + (err.message || err));
    } finally {
      setUploading(false);
    }
  }

  function sendLocation() {
    if (!navigator.geolocation) {
      alert('This device cannot share a location.');
      return;
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      alert('Sharing a location only works on a secure (https) address.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(5));
        const lng = Number(pos.coords.longitude.toFixed(5));
        if (!confirm(`Share your current location with ${chat.title}?`)) return;
        insertExtra({ body: '📍 Location', meta: { t: 'location', lat, lng } });
      },
      (err) => alert(err.code === 1 ? 'Location is blocked. Allow it for this site in your browser settings, then try again.' : 'Could not find your location. Try again.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  async function sendPoll(meta) {
    return insertExtra({ body: `📊 ${meta.q}`.slice(0, 200), meta });
  }

  function addEmoji(e) {
    setText((t) => (t + e).slice(0, isSecret ? MAX_SECRET_CHARS : 4000));
  }
  async function sendSticker(s) {
    setShowStickers(false);
    await insertExtra({ body: `${s} Sticker`, meta: { t: 'sticker', s } });
  }
  async function sendMySticker(dataUrl) {
    setShowStickers(false);
    setUploading(true);
    try {
      const blob = await dataUrlToBlob(dataUrl);
      await sendMedia({ kind: 'image', blob, ext: 'webp', contentType: 'image/webp' });
    } catch (err) {
      alert('Could not send the sticker: ' + (err.message || err));
    } finally {
      setUploading(false);
    }
  }
  async function sendGif(g) {
    setShowStickers(false);
    try {
      const r = await fetch(g.url);
      if (!r.ok) throw new Error('download failed');
      const blob = await r.blob();
      if (blob.size > 10 * 1024 * 1024) throw new Error('that GIF is too big');
      await sendMedia({ kind: 'image', blob, ext: 'gif', contentType: 'image/gif' });
    } catch (err) {
      alert('Could not send the GIF: ' + (err.message || err));
    }
  }

  function pickAttach(kind) {
    setAttachOpen(false);
    if (kind === 'photo' || kind === 'once') {
      onceNext.current = kind === 'once';
      fileRef.current?.click();
    } else if (kind === 'doc') docRef.current?.click();
    else if (kind === 'location') sendLocation();
    else if (kind === 'poll') setShowPoll(true);
  }

  async function vote(messageId, choices) {
    const prevVotes = votes;
    setVotes((v) => ({ ...v, [messageId]: { ...(v[messageId] || {}), [me.id]: choices } }));
    const { error } = await supabase.rpc('vote_poll', { p_message: messageId, p_choices: choices });
    if (error) {
      setVotes(prevVotes);
      alert('Could not save your vote: ' + error.message);
    }
  }

  async function react(messageId, emoji) {
    setPickerFor(null);
    const prevReactions = reactions;
    setReactions((r) => {
      const cur = { ...(r[messageId] || {}) };
      if (emoji) cur[me.id] = emoji;
      else delete cur[me.id];
      return { ...r, [messageId]: cur };
    });
    const { error } = await supabase.rpc('react_message', { p_message: messageId, p_emoji: emoji });
    if (error) {
      setReactions(prevReactions);
      alert('Could not react: ' + error.message);
    }
  }

  // ----- Edit a message you sent (15 minutes) -----
  const canEdit = (m) =>
    m.sender_id === me.id && !m.deleted_for_everyone && isPlainText(m) && (!m.e2ee || ctx?.key) && (isPending(m) || Date.now() - sortKey(m) < EDIT_WINDOW_MS);
  function startEdit(m) {
    setEditing(m);
    setReplyTo(null);
    setCapsuleAt(null);
    setText(textOf(m));
  }
  function cancelEdit() {
    setEditing(null);
    setText('');
  }
  async function saveEdit(body) {
    const m = editing;
    if (!m) return;
    if (body === textOf(m)) {
      cancelEdit();
      return;
    }
    let toSend = body;
    try {
      if (m.e2ee) toSend = await encrypt(ctx.key, body, `${convId}|${me.id}`);
    } catch (err) {
      alert(err.message);
      return;
    }
    const { error } = await supabase.rpc('edit_message', { p_message: m.id, p_body: toSend });
    if (error) {
      alert('Could not edit: ' + error.message);
      return;
    }
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, body: toSend, edited_at: new Date().toISOString() } : x)));
    if (m.e2ee) setPlain((prev) => ({ ...prev, [m.id]: body }));
    cancelEdit();
  }

  // ----- Forward -----
  async function doForward(targetIds) {
    const m = forwardMsg;
    if (!m || !targetIds.length) return;
    const failed = [];
    for (const id of targetIds) {
      try {
        const row = { conversation_id: id, forwarded: true, kind: m.kind };
        if (m.kind === 'text') row.body = m.body;
        if (m.meta) row.meta = m.meta;
        if (m.media_path) row.media_path = await copyMedia(m.media_path, id);
        if (m.duration_ms) row.duration_ms = m.duration_ms;
        const { data, error } = await supabase.from('messages').insert(row).select().single();
        if (error) throw error;
        if (id === convId) addMessage(data);
      } catch (err) {
        failed.push((forwardTargets || []).find((c) => c.conversation_id === id)?.title || 'a chat');
      }
    }
    setForwardMsg(null);
    if (failed.length) alert('Could not forward to: ' + failed.join(', '));
  }
  const canForward = (m) => !isSecret && !m.e2ee && !m.deleted_for_everyone && !m.view_once && !isPending(m) && !!forwardTargets;

  // ----- Save this chat as a text file -----
  async function exportChat() {
    setMenuOpen(false);
    try {
      const all = isSecret ? messages.filter((m) => !m.deleted_for_everyone && (!m.e2ee || typeof plain[m.id] === 'string')) : await fetchAllMessages(convId, 5000);
      const text = chatToText(chat.title, all, (m) => (m.sender_id === me.id ? 'You' : memberNames[m.sender_id] || chat.title), (m) => (m.e2ee ? plain[m.id] || '' : m.body || ''));
      downloadText(`Atomshade_${safeName(chat.title)}_${new Date().toISOString().slice(0, 10)}.txt`, text);
    } catch (err) {
      alert('Could not save the chat: ' + (err.message || err));
    }
  }

  // ----- Search in this chat -----
  useEffect(() => {
    if (!searchOpen) return undefined;
    const q = searchQ.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    if (isSecret) {
      const lower = q.toLowerCase();
      setResults(
        messages
          .filter((m) => m.e2ee && !m.deleted_for_everyone && typeof plain[m.id] === 'string' && plain[m.id].toLowerCase().includes(lower))
          .slice(-50)
          .reverse()
          .map((m) => ({ id: m.id, sort_at: m.sort_at, sender_id: m.sender_id, text: plain[m.id] }))
      );
      return undefined;
    }
    let off = false;
    setSearching(true);
    const t = setTimeout(() => {
      supabase
        .from('messages')
        .select('id, body, sort_at, sender_id, kind, meta')
        .eq('conversation_id', convId)
        .eq('e2ee', false)
        .eq('deleted_for_everyone', false)
        .ilike('body', `%${likeEscape(q)}%`)
        .order('sort_at', { ascending: false })
        .limit(50)
        .then(({ data, error }) => {
          if (off) return;
          setSearching(false);
          setResults(error ? [] : (data || []).map((r) => ({ id: r.id, sort_at: r.sort_at, sender_id: r.sender_id, text: r.body })));
        });
    }, 350);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [searchOpen, searchQ, convId, isSecret, messages, plain]);

  async function jumpTo(r) {
    setSearchOpen(false);
    if (messages.some((x) => x.id === r.id)) {
      setJumpTarget(r.id);
      return;
    }
    const [after, before] = await Promise.all([
      supabase.from('messages').select('*').eq('conversation_id', convId).gte('sort_at', r.sort_at).order('sort_at', { ascending: true }).limit(150),
      supabase.from('messages').select('*').eq('conversation_id', convId).lt('sort_at', r.sort_at).order('sort_at', { ascending: false }).limit(30),
    ]);
    if (after.error || !after.data?.length) {
      alert('Could not open that message.');
      return;
    }
    anchorRef.current = true;
    setAnchor(true);
    setMessages([...(before.data || []).reverse(), ...after.data]);
    setJumpTarget(r.id);
  }

  function backToLatest() {
    anchorRef.current = false;
    setAnchor(false);
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('sort_at', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (data) setMessages(data.slice().reverse());
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      });
  }

  // ----- Voice notes -----
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert('Voice notes are not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime =
        ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) =>
          MediaRecorder.isTypeSupported(t)
        ) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size) chunks.push(ev.data);
      };
      recRef.current = { rec, stream, mime: rec.mimeType || mime, startedAt: Date.now(), chunks };
      rec.start();
      setRecMs(0);
      setRecording(true);
    } catch (err) {
      alert('The microphone is blocked. Allow it for this site in your browser settings, then try again.');
    }
  }

  function stopRecording(shouldSend) {
    const r = recRef.current;
    if (!r) return;
    recRef.current = null;
    setRecording(false);
    r.rec.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      if (!shouldSend) return;
      const durationMs = Date.now() - r.startedAt;
      if (durationMs < 700) return; // an accidental tap
      const type = (r.mime || 'audio/webm').split(';')[0];
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      sendMedia({ kind: 'audio', blob: new Blob(r.chunks, { type }), ext, contentType: type, durationMs });
    };
    try {
      r.rec.stop();
    } catch (err) {
      r.stream.getTracks().forEach((t) => t.stop());
    }
  }

  // Recording timer, and automatic stop at the maximum length.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const r = recRef.current;
      if (!r) return;
      const ms = Date.now() - r.startedAt;
      setRecMs(ms);
      if (ms >= MAX_VOICE_MS) stopRecording(true);
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const visibleMessages = messages.filter((m) => !isExpired(m));

  const statusText = typingName
    ? isGroup
      ? `${typingName} is typing...`
      : 'typing...'
    : isGroup
    ? members.length
      ? `${members.length} members`
      : ''
    : online
    ? 'online'
    : '';

  return (
    <>
      <div className="chat-head">
        <button className="icon-btn back-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <Avatar name={chat.title} seed={chat.other_id || convId} online={!isGroup && online} small />
        <div
          className={`who ${isGroup ? 'clickable' : ''}`}
          role={isGroup ? 'button' : undefined}
          tabIndex={isGroup ? 0 : undefined}
          onClick={isGroup ? () => setShowInfo(true) : undefined}
          onKeyDown={isGroup ? (e) => e.key === 'Enter' && setShowInfo(true) : undefined}
        >
          <div className="name">{isSecret ? '🔒 ' : ''}{chat.title}{chat.other_vibe && !isGroup ? <span className="vibe-pill" title={chat.other_vibe.label}>{chat.other_vibe.icon}</span> : null}</div>
          <div className={`status ${typingName || (!isGroup && online) ? 'live' : ''}`}>{statusText}</div>
        </div>
        <div className="call-head-actions">
          <div className="menu-wrap">
            <button className="icon-btn" title="More" aria-label="More" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>⋮</button>
            {menuOpen && (
              <div className="menu" role="menu">
                {isGroup && <button role="menuitem" onClick={() => { setMenuOpen(false); setShowInfo(true); }}>Group info</button>}
                {isSecret && <button role="menuitem" onClick={() => { setMenuOpen(false); setShowSafety(true); }}>🔒 Safety code</button>}
                <button role="menuitem" onClick={() => { setMenuOpen(false); setSearchQ(''); setResults([]); setSearchOpen(true); }}>🔍 Search</button>
                <button role="menuitem" onClick={exportChat}>⬇ Export chat</button>
                {onChatAction && <button role="menuitem" onClick={() => { setMenuOpen(false); onChatAction('mute'); }}>{chat.muted ? '🔔 Unmute notifications' : '🔕 Mute notifications'}</button>}
                {onChatAction && <button role="menuitem" onClick={() => { setMenuOpen(false); onChatAction('pin'); }}>{chat.pinned ? '📌 Unpin chat' : '📌 Pin chat'}</button>}
                {canSetDisappear && <button role="menuitem" onClick={() => { setMenuOpen(false); setDisappearError(''); setShowDisappear(true); }}>⏳ Disappearing messages</button>}
                {onChatAction && <button role="menuitem" onClick={() => { setMenuOpen(false); onChatAction('rename'); }}>✏️ Edit name</button>}
                {onChatAction && <button role="menuitem" onClick={() => { setMenuOpen(false); onChatAction('archive'); }}>{chat.archived ? '📤 Unarchive' : '📥 Archive'}</button>}
                {onChatAction && <button role="menuitem" onClick={() => { setMenuOpen(false); onChatAction('lock'); }}>{chat.locked ? '🔓 Unlock chat' : '🔒 Lock chat'}</button>}
                {!isGroup && <button role="menuitem" onClick={blockToggle}>{blocked ? 'Unblock' : 'Block'}</button>}
                {!isGroup && <button role="menuitem" onClick={reportUser}>Report</button>}
              </div>
            )}
          </div>
          {isGroup && !isSecret && (
            <>
              <button className="icon-btn" title="Group voice call" aria-label="Group voice call" disabled={callBusy} onClick={() => onGroupCall && onGroupCall('audio')}>
                ☎
              </button>
              <button className="icon-btn" title="Group video call" aria-label="Group video call" disabled={callBusy} onClick={() => onGroupCall && onGroupCall('video')}>
                ▣
              </button>
            </>
          )}
          {!isGroup && (
            <>
              <button className="icon-btn" title="Voice call" aria-label="Voice call" disabled={callBusy} onClick={() => onCall && onCall('audio')}>
                ☎
              </button>
              <button className="icon-btn" title="Video call" aria-label="Video call" disabled={callBusy} onClick={() => onCall && onCall('video')}>
                ▣
              </button>
            </>
          )}
        </div>
      </div>

      {isSecret && (
        <div className="secret-banner">
          🔒 Secret chat: end-to-end encrypted, text only. Atomshade cannot read these messages.
          {ctx?.first && ' Tap ⋮ → Safety code to check it matches your friend’s.'}
        </div>
      )}
      {isSecret && ctx?.pinStatus === 'changed' && (
        <div className="warn-banner">
          ⚠️ {chat.title}’s safety code changed (they may have a new phone, or someone may be interfering). Check the new code with them in person or by a call.
          <button type="button" onClick={() => setShowSafety(true)}>See code</button>
          <button type="button" onClick={acceptNewKey}>I trust the new code</button>
        </div>
      )}
      {isSecret && ctxError && <div className="warn-banner">{ctxError}</div>}
      {disappear && (
        <div className="disappear-banner">
          ⏳ New messages disappear after {disappearLabel(disappear)}.
          {canSetDisappear && <button type="button" onClick={() => { setDisappearError(''); setShowDisappear(true); }}>Change</button>}
        </div>
      )}

      {searchOpen && (
        <div className="search-panel">
          <div className="search-row">
            <input autoFocus type="search" placeholder={isSecret ? 'Search this secret chat (on this device)' : 'Search messages'} value={searchQ} onChange={(e) => setSearchQ(e.target.value)} aria-label="Search messages" maxLength={100} />
            <button type="button" className="icon-btn" onClick={() => setSearchOpen(false)} aria-label="Close search">✕</button>
          </div>
          {searchQ.trim().length >= 2 && (
            <div className="search-results" role="list">
              {searching && <div className="list-empty">Searching…</div>}
              {!searching && results.length === 0 && <div className="list-empty">No messages found.</div>}
              {results.map((r) => (
                <button key={r.id} type="button" role="listitem" onClick={() => jumpTo(r)}>
                  <span className="sr-from">{r.sender_id === me.id ? 'You' : (memberNames[r.sender_id] || chat.title)} · {new Date(r.sort_at).toLocaleDateString([], { dateStyle: 'medium' })}</span>
                  <span className="sr-text">{r.text}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {isGroup && liveCall && !callBusy && (
        <div className="disappear-banner live-call">
          {liveCall.media === 'video' ? '📹' : '📞'} A group {liveCall.media} call is going on ({(liveCall.participants || []).length} in it).
          <button type="button" onClick={() => onJoinGroupCall && onJoinGroupCall(liveCall.call_id, liveCall.media)}>Join</button>
        </div>
      )}
      {anchor && (
        <div className="disappear-banner">
          Looking at older messages.
          <button type="button" onClick={backToLatest}>Back to latest</button>
        </div>
      )}

      <div className="messages">
        {visibleMessages.map((m, i) => {
          const mine = m.sender_id === me.id;
          const prev = visibleMessages[i - 1];
          const showName = isGroup && !mine && (!prev || prev.sender_id !== m.sender_id);
          const once = !!m.view_once;
          const isMedia = !once && (m.kind === 'image' || m.kind === 'audio' || m.kind === 'video');
          return (
            <div key={m.id} data-mid={m.id} className={`bubble-row ${mine ? 'mine' : 'theirs'} ${flash === m.id ? 'flash' : ''}`}>
              <div className={`bubble ${m.meta?.t === 'sticker' && !m.deleted_for_everyone ? 'is-sticker' : ''} ${isMedia ? 'has-media' : ''} ${isMedia && m.kind === 'image' ? 'is-image' : ''} ${isMedia && m.kind === 'video' ? 'is-video' : ''}`}>
                {showName && (
                  <div className="sender-name" style={{ color: nameColor(m.sender_id) }}>
                    {memberNames[m.sender_id] || 'Someone'}
                  </div>
                )}
                {m.reply_to && messagesById[m.reply_to] && (
                  <div className="reply-preview"><strong>{messagesById[m.reply_to].sender_id === me.id ? 'You' : (memberNames[messagesById[m.reply_to].sender_id] || chat.title)}</strong><span>{previewOfMsg(messagesById[m.reply_to])}</span></div>
                )}
                {m.forwarded && !m.deleted_for_everyone && <div className="fwd-tag">↪ Forwarded</div>}
                {m.deleted_for_everyone ? (
                  <span className="deleted-message">This message was deleted</span>
                ) : once ? (
                  <ViewOnceMessage m={m} mine={mine} opened={onceMine.has(m.id)} viewedBy={onceCount[m.id] || 0} onOpened={(id) => setOnceMine((prev) => new Set(prev).add(id))} />
                ) : m.meta?.t === 'file' && m.media_path ? (
                  <FileMessage path={m.media_path} meta={m.meta} />
                ) : m.meta?.t === 'location' ? (
                  <LocationMessage meta={m.meta} />
                ) : m.meta?.t === 'sticker' ? (
                  <div className="sticker-msg" role="img" aria-label="Sticker">{m.meta.s}</div>
                ) : m.meta?.t === 'poll' ? (
                  <PollMessage m={m} votes={votes[m.id]} meId={me.id} onVote={vote} names={{ ...memberNames, [chat.other_id]: chat.title }} />
                ) : m.kind === 'image' ? (
                  <ImageMessage path={m.media_path} onOpen={setLightbox} auto={mine || prefs.autoImages} />
                ) : m.kind === 'video' ? (
                  <VideoMessage path={m.media_path} auto={mine || prefs.autoVideos} />
                ) : m.kind === 'audio' ? (
                  <AudioMessage path={m.media_path} durationMs={m.duration_ms} />
                ) : (
                  textOf(m)
                )}
                {m.deliver_at && (
                  <div className="capsule-tag">
                    {isPending(m) ? `⏳ Opens ${new Date(m.deliver_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : '⏳ Time capsule'}
                  </div>
                )}
                <div className="bubble-meta">
                  {m.edited_at && !m.deleted_for_everyone && <span className="edited-tag">edited</span>}
                  {stars && stars.has(m.id) && <span title="Starred" aria-label="Starred">⭐</span>}
                  {m.expires_at && <span title={`Disappears ${new Date(m.expires_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`} aria-label="Disappearing message">⏳</span>}
                  <span>{clockTime(m.sort_at || m.created_at)}</span>
                  {mine && !isPending(m) && <Ticks message={m} isGroup={isGroup} />}
                </div>
                {!m.deleted_for_everyone && !isPending(m) && <ReactionRow reactions={reactions[m.id]} meId={me.id} messageId={m.id} onReact={react} />}
                {pickerFor === m.id && <ReactionPicker current={reactions[m.id]?.[me.id]} onPick={(e) => react(m.id, e)} />}
                {!m.deleted_for_everyone && <div className="message-actions">
                  <button type="button" onClick={() => { setEditing(null); setReplyTo(m); }} title="Reply to message">Reply</button>
                  {!isPending(m) && <button type="button" onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)} title="React" aria-expanded={pickerFor === m.id}>React</button>}
                  {canEdit(m) && <button type="button" onClick={() => startEdit(m)} title="Edit message">Edit</button>}
                  {canForward(m) && <button type="button" onClick={() => setForwardMsg(m)} title="Forward message">Forward</button>}
                  {stars && !isPending(m) && <button type="button" onClick={() => toggleStar(m)} title={stars.has(m.id) ? 'Remove star' : 'Star message'}>{stars.has(m.id) ? 'Unstar' : 'Star'}</button>}
                  {mine && (isPending(m) || Date.now() - sortKey(m) < 3600 * 1000) && <button type="button" onClick={() => deleteForEveryone(m)} title="Delete for everyone">{isPending(m) ? 'Cancel' : 'Delete'}</button>}
                  {!mine && <button type="button" onClick={() => reportMessage(m)} title="Report message">Report</button>}
                </div>}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {editing && <div className="replying-bar"><div><strong>✏️ Editing message</strong><span>{textOf(editing)}</span></div><button type="button" onClick={cancelEdit} aria-label="Cancel edit">✕</button></div>}
      {replyTo && <div className="replying-bar"><div><strong>Replying to {replyTo.sender_id === me.id ? 'yourself' : (memberNames[replyTo.sender_id] || chat.title)}</strong><span>{previewOfMsg(replyTo)}</span></div><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">✕</button></div>}
      {capsuleAt !== null && (
        <div className="capsule-bar">
          <span>⏳ Time capsule: opens for them at</span>
          <input
            type="datetime-local"
            value={capsuleAt}
            min={localInput(new Date(Date.now() + 60 * 1000))}
            max={localInput(new Date(Date.now() + 365 * 24 * 3600 * 1000))}
            onChange={(e) => setCapsuleAt(e.target.value)}
          />
          <button type="button" onClick={() => setCapsuleAt(null)} aria-label="Cancel time capsule">✕</button>
        </div>
      )}
      {showStickers && <StickerPanel uid={me.id} canSend={!isSecret} onClose={() => setShowStickers(false)} onEmoji={addEmoji} onSticker={sendSticker} onMine={sendMySticker} onGif={sendGif} />}
      {isSecret && keyState !== 'ready' ? (
        <div className="closed-note">
          {keyState === 'restore' || keyState === 'conflict' ? (
            <button className="btn-primary" onClick={onNeedKeys}>🔒 Unlock secret chats on this device</button>
          ) : (
            'Secret chats are getting ready...'
          )}
        </div>
      ) : isSecret && !ctx && !ctxError ? (
        <div className="closed-note">Setting up encryption...</div>
      ) : recording ? (
        <div className="composer recording">
          <button type="button" className="icon-btn" onClick={() => stopRecording(false)} aria-label="Cancel recording">
            ✕
          </button>
          <div className="rec-info">
            <span className="rec-dot" />
            <span className="rec-time">{formatDuration(recMs)}</span>
            <span className="rec-label">Recording</span>
          </div>
          <button type="button" className="send-btn" onClick={() => stopRecording(true)} aria-label="Send voice note">
            ➤
          </button>
        </div>
      ) : (
        <form className="composer" onSubmit={send}>
          {!isSecret && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setAttachOpen(true)}
              disabled={uploading || !!editing}
              aria-label="Attach"
              aria-haspopup="menu"
            >
              <ClipIcon />
            </button>
          )}
          <button
            type="button"
            className={`icon-btn ${capsuleAt !== null ? 'on' : ''}`}
            title="Time capsule: send later"
            disabled={!!editing}
            aria-label="Time capsule"
            onClick={() => setCapsuleAt((v) => (v === null ? localInput(new Date(Date.now() + 60 * 60 * 1000)) : null))}
          >
            ⏳
          </button>
          <button type="button" className={`icon-btn ${showStickers ? 'on' : ''}`} onClick={() => setShowStickers((v) => !v)} disabled={!!editing} aria-label="Emoji, stickers and GIFs" aria-expanded={showStickers} title="Emoji and stickers">😊</button>
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onPickPhoto} />
          <input ref={docRef} type="file" accept={DOC_ACCEPT} hidden onChange={onPickDoc} />
          <input
            placeholder={uploading ? 'Sending...' : isSecret ? 'Secret message' : 'Type a message'}
            value={text}
            maxLength={isSecret ? MAX_SECRET_CHARS : 4000}
            onChange={onType}
            autoFocus
          />
          {text.trim() || isSecret || editing ? (
            <button className="send-btn" aria-label={editing ? 'Save edit' : 'Send'} disabled={(isSecret || !!editing) && (!text.trim() || ctx?.pinStatus === 'changed')}>
              ➤
            </button>
          ) : (
            <button
              type="button"
              className="send-btn"
              onClick={startRecording}
              disabled={uploading}
              aria-label="Record a voice note"
            >
              <MicIcon />
            </button>
          )}
        </form>
      )}

      {attachOpen && <AttachMenu onClose={() => setAttachOpen(false)} onPick={pickAttach} canLocation />}
      {showPoll && <PollModal onClose={() => setShowPoll(false)} onSend={sendPoll} />}
      {forwardMsg && <ForwardModal chats={forwardTargets || []} onClose={() => setForwardMsg(null)} onSend={doForward} />}

      {editVideo && (
        <VideoEditor
          file={editVideo}
          maxSeconds={120}
          onCancel={() => { onceNext.current = false; setEditVideo(null); }}
          onDone={({ blob, type, ext, durationMs }) => {
            setEditVideo(null);
            sendMedia({ kind: 'video', blob, ext, contentType: type, durationMs });
          }}
        />
      )}

      {editFile && (
        <MediaEditor
          file={editFile}
          doneLabel="Send ➤"
          onCancel={() => { onceNext.current = false; setEditFile(null); }}
          onError={() => {
            const f = editFile;
            setEditFile(null);
            prepareAndSend(f); // the editor could not open it: send the original
          }}
          onDone={(blob) => {
            const f = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
            setEditFile(null);
            prepareAndSend(f);
          }}
        />
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Photo" />
        </div>
      )}

      {showDisappear && (
        <div className="modal-bg" onClick={() => setShowDisappear(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Disappearing messages" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>⏳ Disappearing messages</h3><button className="icon-btn" onClick={() => setShowDisappear(false)} aria-label="Close">✕</button></div>
            <p className="modal-sub">New messages in this chat will disappear for everyone after the time you pick. Messages already sent are not affected.</p>
            <div className="radio-list" role="radiogroup" aria-label="Disappear after">
              {DISAPPEAR_CHOICES.map(([v, label]) => (
                <button key={label} type="button" role="radio" aria-checked={(disappear || null) === v} disabled={disappearBusy} className={(disappear || null) === v ? 'on' : ''} onClick={() => saveDisappear(v)}>
                  <span className="radio-dot" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            {disappearError && <p className="form-error" role="alert" style={{ padding: '0 18px 14px' }}>{disappearError}</p>}
          </div>
        </div>
      )}

      {showSafety && ctx && (
        <div className="modal-bg" onClick={() => setShowSafety(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>🔒 Safety code</h3><button className="icon-btn" onClick={() => setShowSafety(false)} aria-label="Close">✕</button></div>
            <p className="modal-sub">If {chat.title} sees exactly the same numbers on their phone, nobody is listening in between you. Compare them in person or on a call.</p>
            <div className="safety-code">{ctx.code}</div>
          </div>
        </div>
      )}

      {showInfo && (
        <GroupInfo
          chat={chat}
          members={members}
          me={me}
          onClose={() => setShowInfo(false)}
          onRenamed={() => onChanged && onChanged()}
          onLeft={() => {
            setShowInfo(false);
            onLeft();
          }}
        />
      )}
    </>
  );
}
