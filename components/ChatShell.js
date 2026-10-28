'use client';

import { I } from './Icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatTime } from '../lib/format';
import Avatar from './Avatar';
import { IconArchive, IconBellOff, IconChat, IconGear, IconLock, IconLogout, IconNewChat, IconPeople, IconPhone, IconPin, IconShade, IconStatus, IconBack } from './Icons';
import AtomLogo from './AtomLogo';
import ChatWindow from './ChatWindow';
import NewChat from './NewChat';
import StatusPanel from './StatusPanel';
import ExplorePanel from './ExplorePanel';
import CallsPanel from './CallsPanel';
import ProfileEdit from './ProfileEdit';
import CallPanel from './CallPanel';
import IncomingCall from './IncomingCall';
import IncomingGroupCall from './IncomingGroupCall';
import GroupCallPanel from './GroupCallPanel';
import { useGroupCallRings } from '../lib/useGroupCallRings';
import ShadePanel from './ShadePanel';
import KeyGate from './KeyGate';
import { prepareKeys } from '../lib/secret';
import { vibeOf } from '../lib/vibes';
import { useIncomingCalls } from '../lib/useIncomingCalls';
import { ChatContextMenu, MuteModal, RenameModal, PinModal } from './ChatOptions';
import { hasPin } from '../lib/pinlock';
import NotifyButton from './NotifyButton';
import SettingsPanel from './SettingsPanel';
import StarredPanel from './StarredPanel';

// Order of the main sections. Swiping left/right moves along this list, like WhatsApp.
const TABS = [
  ['chats', IconChat, 'Chats'],
  ['updates', IconStatus, 'Updates'],
  ['shade', IconShade, 'Shade'],
  ['communities', IconPeople, 'Communities'],
  ['calls', IconPhone, 'Calls'],
];
import { refreshPushOwner, disablePush, pushState } from '../lib/push';

// What to show under a chat's name in the list.
function previewOf(c, meId) {
  if (!c.last_at) return c.is_group ? 'Group created' : 'Say hi';
  const mine = c.last_sender === meId;
  // A deleted message must never show its old text (or the word "null").
  const deleted = c.last_deleted || (c.last_kind === 'text' && !c.last_body);
  if (deleted) return mine ? 'You deleted this message' : 'This message was deleted';
  if (c.last_e2ee) return mine ? 'You: Secret message' : 'Secret message';
  const what = c.last_kind === 'image' ? 'Photo' : c.last_kind === 'video' ? 'Video' : c.last_kind === 'audio' ? 'Voice note' : c.last_body;
  if (mine) return `You: ${what}`;
  if (c.is_group && c.last_sender_name) return `${c.last_sender_name.split(' ')[0]}: ${what}`;
  return what;
}

function toActive(c) {
  return {
    conversation_id: c.conversation_id,
    is_group: c.is_group,
    title: c.title,
    other_id: c.other_id,
    secret: !!c.secret,
    other_vibe: vibeOf(c.other_vibe, c.other_vibe_until),
    nickname: c.nickname || null,
    real_title: c.real_title || c.title,
    archived: !!c.archived,
    locked: !!c.locked,
    pinned: !!c.pinned,
    muted: !!c.muted,
  };
}

export default function ChatShell({ me, onProfileChange }) {
  const [chats, setChats] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showStarred, setShowStarred] = useState(false);
  const [showOnline, setShowOnline] = useState(true); // my own "show when I'm online" setting
  const [tab, setTabRaw] = useState('chats'); // 'chats' | 'updates' | 'shade' | 'communities' | 'calls'
  const [slideDir, setSlideDir] = useState('none'); // which way the new section slides in
  const tabRef = useRef('chats');
  const setTab = useCallback((next) => {
    const from = TABS.findIndex((t) => t[0] === tabRef.current);
    const to = TABS.findIndex((t) => t[0] === next);
    if (to < 0 || to === from) return;
    tabRef.current = next;
    setSlideDir(to > from ? 'next' : 'prev');
    setTabRaw(next);
  }, []);
  const goTabBy = useCallback((step) => {
    const i = TABS.findIndex((t) => t[0] === tabRef.current);
    const j = i + step;
    if (j >= 0 && j < TABS.length) setTab(TABS[j][0]);
  }, [setTab]);
  const swipe = useRef(null);
  const swiped = useRef(0);
  const wheelAcc = useRef({ x: 0, t: 0, lock: 0 });
  // True when the touch started somewhere that scrolls sideways or takes typing: leave those alone.
  const swipeBlocked = (el) => {
    for (let n = el; n && n.nodeType === 1 && !n.classList?.contains('sidebar'); n = n.parentElement) {
      const tag = n.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'NAV' || n.dataset?.noswipe !== undefined) return true;
      if (n.scrollWidth > n.clientWidth + 4 && ['auto', 'scroll'].includes(getComputedStyle(n).overflowX)) return true;
    }
    return false;
  };
  const swipeProps = {
    onTouchStart: (e) => {
      if (e.touches.length !== 1 || swipeBlocked(e.target)) { swipe.current = null; return; }
      swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    },
    onTouchEnd: (e) => {
      const st = swipe.current;
      swipe.current = null;
      if (!st || !e.changedTouches[0]) return;
      const dx = e.changedTouches[0].clientX - st.x;
      const dy = e.changedTouches[0].clientY - st.y;
      // A deliberate, mostly-sideways flick: far enough, and clearly more sideways than up/down.
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6 || Date.now() - st.t > 900) return;
      // The finger ended on some button after sliding: do not also "tap" it.
      swiped.current = Date.now();
      goTabBy(dx < 0 ? 1 : -1);
    },
    onClickCapture: (e) => {
      if (Date.now() - swiped.current < 450) { e.preventDefault(); e.stopPropagation(); }
    },
    onTouchCancel: () => { swipe.current = null; },
    // Two-finger sideways scroll on a laptop trackpad does the same.
    onWheel: (e) => {
      const w = wheelAcc.current;
      const now = Date.now();
      if (now < w.lock || Math.abs(e.deltaX) < Math.abs(e.deltaY) || swipeBlocked(e.target)) return;
      if (now - w.t > 220) w.x = 0;
      w.t = now;
      w.x += e.deltaX;
      if (Math.abs(w.x) > 90) {
        goTabBy(w.x > 0 ? 1 : -1);
        w.x = 0;
        w.lock = now + 600;
      }
    },
  };
  const [keyState, setKeyState] = useState('checking'); // 'checking' | 'ready' | 'restore' | 'conflict' | 'error'
  const [showKeyGate, setShowKeyGate] = useState(false);
  const [shadeUnread, setShadeUnread] = useState(0);
  const [callsRefresh, setCallsRefresh] = useState(0);
  const [online, setOnline] = useState(new Set());
  const [search, setSearch] = useState('');
  const [activeCall, setActiveCall] = useState(null); // { callId, role, media, peer }
  const [view, setView] = useState('main'); // 'main' | 'archived' | 'locked'
  const [notifyState, setNotifyState] = useState('checking');
  const [notifyHidden, setNotifyHidden] = useState(true);
  const [pendingChat, setPendingChat] = useState(null); // a chat to open (from tapping a notification)
  const [ctx, setCtx] = useState(null); // { chat, x, y }
  const [renaming, setRenaming] = useState(null);
  const [muting, setMuting] = useState(null);
  const [pinAsk, setPinAsk] = useState(null); // { mode, then }
  const [lockedOpen, setLockedOpen] = useState(false); // PIN entered this visit
  const pressTimer = useRef(null);
  const pressed = useRef(false);
  const [groupCall, setGroupCall] = useState(null); // { id, conversation_id, media, title }
  const { incoming, clear: clearIncoming } = useIncomingCalls(me.id, !!activeCall || !!groupCall);
  const { ring, clear: clearRing } = useGroupCallRings(me.id, !!activeCall || !!groupCall);

  const loadChats = useCallback(async () => {
    let { data, error } = await supabase.rpc('my_chat_list');
    // Older database without update-chat-options.sql: keep the app working.
    if (error) ({ data, error } = await supabase.rpc('my_chats'));
    if (!error && Array.isArray(data)) {
      // Pinned / muted flags come from a separate call (older databases simply have none).
      const flags = await supabase.rpc('my_chat_flags');
      const byId = {};
      if (!flags.error && Array.isArray(flags.data)) flags.data.forEach((f) => { byId[f.conversation_id] = f; });
      setChats(data.map((c) => ({ ...c, pinned: !!byId[c.conversation_id]?.pinned, muted: !!byId[c.conversation_id]?.muted })));
    }
    setLoaded(true);
  }, []);
  // Realtime events can come in bursts (for example when a chat is marked read), so wait a moment and refresh once.
  const loadChatsSoon = useMemo(() => {
    let t = null;
    const fn = () => {
      clearTimeout(t);
      t = setTimeout(loadChats, 400);
    };
    fn.cancel = () => clearTimeout(t);
    return fn;
  }, [loadChats]);

  // Chat list + "delivered" ticks + live updates
  useEffect(() => {
    loadChats();

    // Anything sent to me while I was away is now delivered.
    supabase
      .from('messages')
      .update({ delivered_at: new Date().toISOString() })
      .is('delivered_at', null)
      .neq('sender_id', me.id)
      .then(() => {});

    const channel = supabase
      .channel('inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const m = payload.new;
        if (m.sender_id !== me.id) {
          supabase
            .from('messages')
            .update({ delivered_at: new Date().toISOString() })
            .eq('id', m.id)
            .then(() => {});
        }
        loadChatsSoon();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => loadChatsSoon())
      // Someone added me to a new group
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${me.id}` },
        () => loadChatsSoon()
      )
      .subscribe();

    return () => {
      loadChatsSoon.cancel();
      supabase.removeChannel(channel);
    };
  }, [me.id, loadChats, loadChatsSoon]);

  // Notifications: keep this device's alerts tied to whoever is logged in, and open the chat a tapped notification points to.
  useEffect(() => {
    refreshPushOwner();
    pushState().then(setNotifyState);
    try {
      setNotifyHidden(localStorage.getItem('atomshade.notify.dismissed') === '1');
    } catch {
      setNotifyHidden(false);
    }
    try {
      const q = new URLSearchParams(window.location.search).get('chat');
      if (q) {
        setPendingChat(q);
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch {
      /* ignore */
    }
    const onMsg = (e) => {
      if (e.data && e.data.type === 'open-chat' && e.data.conv) setPendingChat(e.data.conv);
    };
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker && navigator.serviceWorker.removeEventListener('message', onMsg);
  }, []);
  useEffect(() => {
    if (!pendingChat) return;
    const c = chats.find((x) => x.conversation_id === pendingChat);
    if (!c) return; // wait for the list to load
    setPendingChat(null);
    if (!c.locked) setActive(toActive(c));
  }, [pendingChat, chats]);

  // Make sure this device has a secret-chat key (created once, kept on this device).
  const refreshKeys = useCallback(async () => {
    try {
      const r = await prepareKeys(me.id);
      setKeyState(r.state);
    } catch (e) {
      setKeyState('error');
    }
  }, [me.id]);
  useEffect(() => {
    refreshKeys();
  }, [refreshKeys]);

  // A little dot on the Shade tab when someone has sent you something.
  useEffect(() => {
    let stop = false;
    async function poll() {
      const { data, error } = await supabase.rpc('my_shade_threads');
      if (!stop && !error && Array.isArray(data)) setShadeUnread(data.filter((t) => t.unread).length);
    }
    poll();
    const id = setInterval(poll, 30000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  // My privacy setting: do I show as online?
  useEffect(() => {
    supabase.rpc('get_my_settings').then(({ data, error }) => {
      if (error) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (row && row.show_online === false) setShowOnline(false);
    });
  }, []);

  // Who is online right now (if I hide my own status I still see others, but nobody sees me)
  useEffect(() => {
    const channel = supabase.channel('presence:online', { config: { presence: { key: me.id } } });
    channel
      .on('presence', { event: 'sync' }, () => {
        const ids = new Set(Object.keys(channel.presenceState()));
        ids.delete(me.id);
        setOnline(ids);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED' && showOnline) await channel.track({ at: Date.now() });
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [me.id, showOnline]);

  async function startChatWith(person, secret = false) {
    if (secret && keyState !== 'ready') {
      setShowNew(false);
      if (keyState === 'restore' || keyState === 'conflict') setShowKeyGate(true);
      else alert('Secret chats are still getting ready on this device. Try again in a moment.');
      return;
    }
    const { data, error } = secret
      ? await supabase.rpc('create_or_get_secret_dm', { other: person.id })
      : await supabase.rpc('create_or_get_dm', { other: person.id });
    if (error) {
      alert(error.message);
      return;
    }
    setShowNew(false);
    setActive({ conversation_id: data, is_group: false, title: person.name, other_id: person.id, secret });
    loadChats();
  }

  async function createGroup(name, memberIds) {
    const { data, error } = await supabase.rpc('create_group', { group_name: name, member_ids: memberIds });
    if (error) {
      alert(error.message);
      return;
    }
    setShowNew(false);
    setActive({ conversation_id: data, is_group: true, title: name, other_id: null });
    loadChats();
  }

  // Group calls: start one (or join the one already going on) and open the call window.
  async function startGroupCall(chat, media) {
    if (activeCall || groupCall) return;
    if (!navigator.mediaDevices?.getUserMedia && typeof window !== 'undefined' && window.isSecureContext === false) {
      alert('Calls only work on a secure (https) address. Open the app from its https link.');
      return;
    }
    const { data, error } = await supabase.rpc('start_group_call', { p_conv: chat.conversation_id, p_media: media });
    if (error || !data) {
      alert(error ? (error.code === 'PGRST202' ? 'Group calls need the latest database update (update-group-calls.sql).' : error.message) : 'Could not start the call.');
      return;
    }
    setGroupCall({ id: data, conversation_id: chat.conversation_id, media, title: chat.title });
  }
  function joinGroupCall(convId, callId, media, title) {
    if (activeCall || groupCall) return;
    setGroupCall({ id: callId, conversation_id: convId, media, title });
  }

  async function startCall(chat, media) {
    if (activeCall || !chat.other_id) return;
    const { data, error } = await supabase.rpc('start_call', { p_callee: chat.other_id, p_media: media });
    if (error) {
      alert(
        error.code === 'PGRST202'
          ? 'Calling is not set up yet. Run update-v0.7.1-fixes.sql in Supabase (see UPDATE-v0.7.1.md).'
          : error.message
      );
      return;
    }
    setActiveCall({ callId: data, role: 'caller', media, peer: { id: chat.other_id, name: chat.title } });
  }

  async function acceptIncoming() {
    const call = incoming;
    if (!call) return;
    clearIncoming(call.id);
    const { data, error } = await supabase.rpc('update_call', { p_call: call.id, p_action: 'accept' });
    if (error || data !== 'accepted') {
      alert('That call has already ended.');
      return;
    }
    setActiveCall({ callId: call.id, role: 'callee', media: call.media, peer: { id: call.caller_id, name: call.callerName } });
  }

  async function declineIncoming() {
    const call = incoming;
    if (!call) return;
    clearIncoming(call.id);
    await supabase.rpc('update_call', { p_call: call.id, p_action: 'decline' });
  }

  const term = search.trim().toLowerCase();
  const totalUnread = chats.reduce((n, c) => n + (c.locked || c.archived || c.muted ? 0 : Number(c.unread_count) || 0), 0);
  // People you already chat with (used for Inner Orbit and the new-chat list).
  const contacts = useMemo(() => {
    const seen = new Set();
    return chats
      .filter((c) => !c.is_group && c.other_id && !seen.has(c.other_id) && seen.add(c.other_id))
      .map((c) => ({ id: c.other_id, name: c.title }));
  }, [chats]);
  const groups = useMemo(() => chats.filter((c) => c.is_group), [chats]);
  const archivedChats = chats.filter((c) => c.archived && !c.locked);
  const lockedChats = chats.filter((c) => c.locked);
  const lockedUnread = lockedChats.reduce((n, c) => n + (Number(c.unread_count) || 0), 0);
  const hasChatOptions = chats.some((c) => 'locked' in c);
  const pool = view === 'locked' ? lockedChats : view === 'archived' ? archivedChats : chats.filter((c) => !c.archived && !c.locked);
  const shownChats = pool
    .filter((c) => !term || (c.title || '').toLowerCase().includes(term))
    .map((c, i) => [c, i])
    .sort((a, b) => (view === 'main' ? Number(!!b[0].pinned) - Number(!!a[0].pinned) : 0) || a[1] - b[1])
    .map(([c]) => c);
  const forwardTargets = chats.filter((c) => !c.secret && !c.locked);
  const activeNow = active ? chats.find((c) => c.conversation_id === active.conversation_id) : null;
  const activeChat = active ? { ...active, ...(activeNow ? toActive(activeNow) : {}), other_vibe: activeNow ? toActive(activeNow).other_vibe : active.other_vibe } : null;

  // ----- chat options (right-click on PC, long-press on phone) -----
  async function setPref(chat, field, text, bool) {
    const { error } = await supabase.rpc('set_chat_pref', { p_conv: chat.conversation_id, p_field: field, p_text: text ?? null, p_bool: bool ?? null });
    if (error) {
      alert(error.code === 'PGRST202' ? 'This needs the latest database update (update-chat-options.sql).' : error.message);
      return false;
    }
    await loadChats();
    return true;
  }
  function openMenu(chat, x, y) {
    if (!hasChatOptions) {
      alert('Chat options need the latest database update (update-chat-options.sql).');
      return;
    }
    setCtx({ chat, x, y });
  }
  function pick(action, chat) {
    setCtx(null);
    if (action === 'rename') setRenaming(chat);
    else if (action === 'pin') setPref(chat, 'pinned', null, !chat.pinned);
    else if (action === 'mute') {
      if (chat.muted) setMute(chat, 0);
      else setMuting(chat);
    }
    else if (action === 'archive') {
      setPref(chat, 'archived', null, !chat.archived);
      if (active?.conversation_id === chat.conversation_id && !chat.archived) setActive(null);
    } else if (action === 'lock') {
      if (chat.locked) setPref(chat, 'locked', null, false);
      else if (!hasPin(me.id)) setPinAsk({ mode: 'set', then: () => lockIt(chat) });
      else lockIt(chat);
    }
  }
  async function setMute(chat, hours) {
    setMuting(null);
    const { error } = await supabase.rpc('set_chat_mute', { p_conv: chat.conversation_id, p_hours: hours });
    if (error) alert(error.code === 'PGRST202' ? 'This needs the latest database update (update-whatsapp-extras.sql).' : error.message);
    else await loadChats();
  }
  async function lockIt(chat) {
    if (await setPref(chat, 'locked', null, true)) {
      if (active?.conversation_id === chat.conversation_id) setActive(null);
    }
  }
  function openLockedFolder() {
    if (lockedOpen) return setView('locked');
    if (!hasPin(me.id)) return setView('locked');
    setPinAsk({ mode: 'enter', then: () => { setLockedOpen(true); setView('locked'); } });
  }
  function leaveFolder() {
    setView('main');
    setLockedOpen(false);
    setSearch('');
  }
  // Open a chat from somewhere other than the list (starred messages). Locked chats still ask for the PIN.
  function openChatById(convId) {
    const c = chats.find((x) => x.conversation_id === convId);
    if (!c) {
      alert('That chat is not available any more.');
      return;
    }
    setShowStarred(false);
    setShowSettings(false);
    const go = () => {
      setView('main');
      setActive(toActive(c));
    };
    if (c.locked && hasPin(me.id) && !lockedOpen) setPinAsk({ mode: 'enter', then: () => { setLockedOpen(true); go(); } });
    else go();
  }
  function logOut() {
    if (confirm(`Log out of Atomshade${me.email ? ' (' + me.email + ')' : ''}?`)) {
      disablePush(false).finally(() => supabase.auth.signOut());
    }
  }

  const pressProps = (c) => ({
    onContextMenu: (e) => {
      e.preventDefault();
      openMenu(c, e.clientX, e.clientY);
    },
    onTouchStart: (e) => {
      pressed.current = false;
      const t = e.touches[0];
      clearTimeout(pressTimer.current);
      pressTimer.current = setTimeout(() => {
        pressed.current = true;
        if (navigator.vibrate) navigator.vibrate(15);
        openMenu(c, t.clientX, t.clientY);
      }, 500);
    },
    onTouchMove: () => clearTimeout(pressTimer.current),
    onTouchEnd: (e) => {
      clearTimeout(pressTimer.current);
      if (pressed.current) e.preventDefault(); // long-press must not also open the chat
    },
    onTouchCancel: () => clearTimeout(pressTimer.current),
    onKeyDown: (e) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        openMenu(c, r.left + 24, r.top + 24);
      }
    },
  });

  return (
    <div className={`app ${active ? 'chat-open' : ''}`}>
      <aside className="sidebar" {...swipeProps}>
        <div className="sidebar-head">
          <div className="brand">
            <AtomLogo size={36} />
            <span className="logo-text">Atomshade</span>
          </div>
          <div className="head-actions">
            <button className="icon-btn" title="New chat or group" aria-label="New chat or group" onClick={() => setShowNew(true)}>
              <IconNewChat size={21} />
            </button>
            <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => setShowSettings(true)}>
              <IconGear size={21} />
            </button>
            <button className="icon-btn" title="Log out" aria-label="Log out" onClick={logOut}>
              <IconLogout size={21} />
            </button>
          </div>
        </div>

        <button type="button" className="me-strip" onClick={() => setShowProfile(true)} title="My profile">
          <span className="me-initial">{(me.name || me.email || '?').trim().charAt(0).toUpperCase()}</span>
          <span className="me-text">
            <b>{me.name || 'My profile'}</b>
            <small>{me.email || 'Signed in'}</small>
          </span>
        </button>

        <div key={tab} className={`tab-pane slide-${slideDir}`}>
        {tab === 'chats' && (
          <div className="search">
            <input placeholder="Search chats" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}

        {tab === 'updates' && (
          <div className="tab-body">
            <StatusPanel me={me} people={contacts} embedded onClose={() => setTab('chats')} />
          </div>
        )}
        {tab === 'shade' && (
          <div className="tab-body">
            <ShadePanel me={me} groups={groups} onUnread={setShadeUnread} />
          </div>
        )}
        {tab === 'communities' && (
          <div className="tab-body">
            <ExplorePanel me={me} embedded onClose={() => setTab('chats')} />
          </div>
        )}
        {tab === 'calls' && (
          <div className="tab-body">
            <CallsPanel me={me} busy={!!activeCall} refreshKey={callsRefresh} onCall={startCall} />
          </div>
        )}

        {tab === 'chats' && !notifyHidden && notifyState === 'off' && (
          <div className="notify-banner">
            <span>Get notified about new messages and calls</span>
            <NotifyButton compact onChange={setNotifyState} />
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setNotifyHidden(true);
                try { localStorage.setItem('atomshade.notify.dismissed', '1'); } catch { /* ignore */ }
              }}
            >
              Not now
            </button>
          </div>
        )}
        {tab === 'chats' && (keyState === 'restore' || keyState === 'conflict') && (
          <button className="key-banner" onClick={() => setShowKeyGate(true)}>
            <I n="lock" /> Unlock your secret chats on this device
          </button>
        )}

        {tab === 'chats' && (
        <div className="chat-list">
          {view !== 'main' && (
            <button className="folder-row back" onClick={leaveFolder}>
              <span className="folder-ico"><IconBack size={18} /></span> {view === 'locked' ? 'Locked chats' : 'Archived chats'}
            </button>
          )}
          {view === 'main' && !term && archivedChats.length > 0 && (
            <button className="folder-row" onClick={() => setView('archived')}>
              <span className="folder-ico"><IconArchive size={20} /></span> Archived <em>{archivedChats.length}</em>
            </button>
          )}
          {view === 'main' && !term && lockedChats.length > 0 && (
            <button className="folder-row" onClick={openLockedFolder}>
              <span className="folder-ico"><IconLock size={20} /></span> Locked chats {lockedUnread > 0 && <i className="dot" aria-label="Unread in locked chats" />}
            </button>
          )}
          {view !== 'main' && loaded && shownChats.length === 0 && <div className="list-empty">Nothing here.</div>}
          {loaded && chats.length === 0 && (
            <div className="list-empty">
              No chats yet.
              <br />
              Tap the new-chat button at the top to start one with a friend.
            </div>
          )}
          {shownChats.map((c) => (
            <button
              key={c.conversation_id}
              className={`chat-item ${active?.conversation_id === c.conversation_id ? 'active' : ''}`}
              onClick={() => setActive(toActive(c))}
              {...pressProps(c)}
            >
              <Avatar
                name={c.title}
                seed={c.other_id || c.conversation_id}
                online={!c.is_group && online.has(c.other_id)}
              />
              <div className="chat-meta">
                <div className="chat-row">
                  <span className="chat-name">
                    {c.secret && <span className="secret-ico" aria-label="Secret chat"><IconLock size={13} /></span>}
                    {c.title}
                    {vibeOf(c.other_vibe, c.other_vibe_until) && (
                      <span className="vibe-pill" title={vibeOf(c.other_vibe, c.other_vibe_until).label}>
                        {vibeOf(c.other_vibe, c.other_vibe_until).icon}
                      </span>
                    )}
                  </span>
                  <span className={`chat-time ${c.unread_count > 0 ? 'unread' : ''}`}>{formatTime(c.last_at)}</span>
                </div>
                <div className="chat-row">
                  <span className="chat-preview">{view === 'locked' ? 'Locked' : previewOf(c, me.id)}</span>
                  {c.muted && <span className="chat-flag" title="Muted" aria-label="Muted"><IconBellOff size={15} /></span>}
                  {c.pinned && view === 'main' && <span className="chat-flag" title="Pinned" aria-label="Pinned"><IconPin size={15} /></span>}
                  {c.unread_count > 0 && <span className={`badge ${c.muted ? 'muted' : ''}`}>{c.unread_count}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
        )}
        </div>

        <nav className="tabbar" aria-label="Main sections">
          {TABS.map(([key, Icon, label]) => (
            <button key={key} className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>
              <span className="tab-icon">
                <Icon size={23} />
                {key === 'shade' && shadeUnread > 0 && <span className="tab-badge">{shadeUnread}</span>}
                {key === 'chats' && totalUnread > 0 && <span className="tab-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
              </span>
              <span className="tab-label">{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        {active ? (
          <ChatWindow
            key={active.conversation_id}
            me={me}
            chat={activeChat}
            onChatAction={(a) => pick(a, activeNow ? toActive(activeNow) : active)}
            onChanged={loadChats}
            forwardTargets={forwardTargets}
            keyState={keyState}
            onNeedKeys={() => setShowKeyGate(true)}
            online={active.other_id ? online.has(active.other_id) : false}
            onBack={() => setActive(null)}
            onCall={(media) => startCall(active, media)}
            callBusy={!!activeCall || !!groupCall}
            onGroupCall={(media) => startGroupCall(active, media)}
            onJoinGroupCall={(callId, media) => joinGroupCall(active.conversation_id, callId, media, activeChat.title)}
            onLeft={() => {
              setActive(null);
              loadChats();
            }}
          />
        ) : (
          <div className="empty-state">
            <div>
              <div style={{ display: 'grid', placeItems: 'center', marginBottom: 18 }}>
                <AtomLogo size={84} />
              </div>
              <h2>Atomshade</h2>
              <p>Pick a chat on the left, or start a new one with the new-chat button at the top.</p>
            </div>
          </div>
        )}
      </main>

      {ring && !activeCall && !groupCall && (
        <IncomingGroupCall
          ring={ring}
          onJoin={() => {
            const r = ring;
            clearRing(r.id);
            joinGroupCall(r.conversation_id, r.id, r.media, r.title);
          }}
          onDismiss={() => clearRing(ring.id)}
        />
      )}
      {groupCall && <GroupCallPanel key={groupCall.id} me={me} call={groupCall} onClose={() => setGroupCall(null)} />}
      {incoming && !activeCall && !groupCall && (
        <IncomingCall call={incoming} onAccept={acceptIncoming} onDecline={declineIncoming} onTimeout={() => clearIncoming(incoming.id)} />
      )}
      {activeCall && (
        <CallPanel
          key={activeCall.callId}
          me={me}
          peer={activeCall.peer}
          role={activeCall.role}
          media={activeCall.media}
          callId={activeCall.callId}
          onClose={() => {
            setActiveCall(null);
            setCallsRefresh((n) => n + 1);
          }}
        />
      )}


      {ctx && <ChatContextMenu chat={ctx.chat} x={ctx.x} y={ctx.y} onPick={(a) => pick(a, ctx.chat)} onClose={() => setCtx(null)} />}
      {muting && <MuteModal chat={muting} onPick={(h) => setMute(muting, h)} onClose={() => setMuting(null)} />}
      {renaming && (
        <RenameModal
          chat={renaming}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            if (await setPref(renaming, 'nickname', name, null)) setRenaming(null);
          }}
        />
      )}
      {pinAsk && (
        <PinModal
          userId={me.id}
          mode={pinAsk.mode}
          onClose={() => setPinAsk(null)}
          onDone={() => {
            const then = pinAsk.then;
            setPinAsk(null);
            then && then();
          }}
        />
      )}

      {showSettings && (
        <SettingsPanel
          me={me}
          onClose={() => setShowSettings(false)}
          onEditProfile={() => setShowProfile(true)}
          onOpenStarred={() => setShowStarred(true)}
          onShowOnlineChange={setShowOnline}
          onLogout={logOut}
        />
      )}
      {showStarred && <StarredPanel me={me} onOpen={openChatById} onClose={() => setShowStarred(false)} />}

      {showProfile && (
        <ProfileEdit me={me} people={contacts} keyState={keyState} onSaved={(p) => onProfileChange && onProfileChange(p)} onClose={() => setShowProfile(false)} />
      )}

      {showKeyGate && (
        <KeyGate
          userId={me.id}
          state={keyState}
          onClose={() => setShowKeyGate(false)}
          onDone={() => {
            setShowKeyGate(false);
            refreshKeys();
          }}
        />
      )}

      {showNew && (
        <NewChat
          me={me}
          online={online}
          recent={contacts}
          onPickPerson={startChatWith}
          onCreateGroup={createGroup}
          onClose={() => setShowNew(false)}
        />
      )}
    </div>
  );
}
