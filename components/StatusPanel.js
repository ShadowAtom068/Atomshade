'use client';

import { I } from './Icons';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatTime } from '../lib/format';
import Avatar from './Avatar';
import OrbitEditor from './OrbitEditor';
import MediaEditor from './MediaEditor';
import VideoEditor from './VideoEditor';

const STATUS_BUCKET = 'status-media';
const BACKGROUNDS = ['#5b21b6', '#0f766e', '#1d4ed8', '#be123c', '#92400e', '#27272a'];
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_SONG_BYTES = 15 * 1024 * 1024;
const SONG_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav'];

function remaining(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / 3600000);
  return hours ? `${hours}h left` : `${Math.max(1, Math.floor(ms / 60000))}m left`;
}

async function signedStatusUrl(path) {
  const { data, error } = await supabase.storage.from(STATUS_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export default function StatusPanel({ me, people = [], onClose, embedded = false }) {
  const [audience, setAudience] = useState('everyone'); // 'everyone' | 'inner'
  const [showOrbit, setShowOrbit] = useState(false);
  const [statuses, setStatuses] = useState([]);
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('text');
  const [background, setBackground] = useState(BACKGROUNDS[0]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const [composing, setComposing] = useState(false);
  const [viewing, setViewing] = useState(null); // { userId, index }
  const [editing, setEditing] = useState(null); // a photo being edited
  const [editingVideo, setEditingVideo] = useState(null);
  const [song, setSong] = useState(null); // { file, title, duration }
  const [songStart, setSongStart] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const songRef = useRef(null);
  const previewRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState('');

  async function load() {
    const { data, error: loadError } = await supabase
      .from('statuses')
      .select('id, user_id, body, kind, media_path, background, audience, created_at, expires_at, audio_path, audio_start, audio_title, profiles!statuses_user_id_fkey(name)')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (loadError) { setError(loadError.message); return; }
    const rows = await Promise.all((data || []).map(async (s) => {
      if (!s.media_path) return s;
      let out = s;
      try { out = { ...out, media_url: await signedStatusUrl(s.media_path) }; }
      catch { out = { ...out, media_url: null }; }
      if (s.audio_path) {
        try { out = { ...out, audio_url: await signedStatusUrl(s.audio_path) }; }
        catch { out = { ...out, audio_url: null }; }
      }
      return out;
    }));
    setStatuses(rows);
  }

  useEffect(() => {
    load();
    const channel = supabase.channel('statuses-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'statuses' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  function chooseFile(e) {
    const picked = e.target.files?.[0] || null;
    e.target.value = '';
    if (!picked) return;
    if (!picked.type.startsWith('image/') && !picked.type.startsWith('video/')) {
      setError('Choose an image or video file.'); return;
    }
    if (picked.size > (picked.type.startsWith('video/') ? 400 * 1024 * 1024 : MAX_MEDIA_BYTES)) {
      setError(picked.type.startsWith('video/') ? 'Choose a video under 400 MB.' : 'Choose a file smaller than 50 MB.'); return;
    }
    setKind(picked.type.startsWith('video/') ? 'video' : 'image');
    setError('');
    // Photos open in the editor first (GIFs would lose their motion).
    if (picked.type.startsWith('image/') && picked.type !== 'image/gif') setEditing(picked);
    else if (picked.type.startsWith('video/')) setEditingVideo(picked);
    else setFile(picked);
  }

  function chooseSong(e) {
    const f = e.target.files?.[0] || null;
    e.target.value = '';
    if (!f) return;
    if (!SONG_TYPES.includes(f.type)) { setError('Pick a song file (MP3, M4A, WAV, OGG or AAC).'); return; }
    if (f.size > MAX_SONG_BYTES) { setError('That song file is too big. Pick one under 15 MB.'); return; }
    const url = URL.createObjectURL(f);
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      setSong({ file: f, title: f.name.replace(/\.[^.]+$/, '').slice(0, 80), duration: Number.isFinite(a.duration) ? a.duration : 0 });
      setSongStart(0);
      setPreviewUrl(url);
      setError('');
    };
    a.onerror = () => { URL.revokeObjectURL(url); setError('Could not read that song. Try a different file.'); };
    a.src = url;
  }
  function removeSong() {
    setPreviewing(false);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setSong(null);
    setSongStart(0);
  }
  function togglePreview() {
    const a = previewRef.current;
    if (!a) return;
    if (previewing) { a.pause(); setPreviewing(false); return; }
    a.currentTime = songStart;
    a.play().then(() => setPreviewing(true)).catch(() => setError('Your browser would not play the preview.'));
  }

  async function postStatus(e) {
    e.preventDefault();
    const value = body.trim();
    if (kind === 'text' && !value) return;
    if ((kind === 'image' || kind === 'video') && !file) {
      setError('Choose a photo or video first.'); return;
    }
    setBusy(true); setError('');
    let mediaPath = null;
    try {
      if (file && kind !== 'text') {
        const ext = (file.name.split('.').pop() || (kind === 'video' ? 'mp4' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
        mediaPath = `${me.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from(STATUS_BUCKET).upload(mediaPath, file, {
          contentType: file.type || 'application/octet-stream', cacheControl: '3600', upsert: false,
        });
        if (uploadError) throw uploadError;
      }
      let audioPath = null;
      if (song && kind !== 'text') {
        const sext = (song.file.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
        audioPath = `${me.id}/${crypto.randomUUID()}.${sext}`;
        const { error: songError } = await supabase.storage.from(STATUS_BUCKET).upload(audioPath, song.file, {
          contentType: song.file.type, cacheControl: '3600', upsert: false,
        });
        if (songError) {
          if (mediaPath) await supabase.storage.from(STATUS_BUCKET).remove([mediaPath]);
          throw songError;
        }
      }
      const { error: postError } = await supabase.from('statuses').insert({
        ...(audioPath ? { audio_path: audioPath, audio_start: Math.max(0, Math.floor(songStart)), audio_title: song.title } : {}),
        user_id: me.id,
        body: value || null,
        kind,
        media_path: mediaPath,
        background: kind === 'text' ? background : null,
        audience,
      });
      if (postError) {
        const gone = [mediaPath, audioPath].filter(Boolean);
        if (gone.length) await supabase.storage.from(STATUS_BUCKET).remove(gone);
        throw postError;
      }
      setBody(''); setFile(null); setKind('text'); removeSong();
      setComposing(false);
      await load();
    } catch (err) {
      setError(err.message || 'Could not post status.');
    } finally { setBusy(false); }
  }

  async function removeStatus(status) {
    if (!confirm('Delete this status?')) return;
    const { error: deleteError } = await supabase.from('statuses').delete().eq('id', status.id);
    if (deleteError) { setError(deleteError.message); return; }
    const files = [status.media_path, status.audio_path].filter(Boolean);
    if (files.length) await supabase.storage.from(STATUS_BUCKET).remove(files);
    await load();
  }

  // Group by person: oldest first inside a person (like WhatsApp), people sorted by newest update.
  const groups = [];
  const byUser = new Map();
  for (const st of [...statuses].reverse()) {
    if (!byUser.has(st.user_id)) {
      const g = { userId: st.user_id, name: st.user_id === me.id ? 'My status' : (st.profiles?.name || 'Atomshade user'), items: [] };
      byUser.set(st.user_id, g);
      groups.push(g);
    }
    byUser.get(st.user_id).items.push(st);
  }
  const mine = byUser.get(me.id);
  const others = groups
    .filter((g) => g.userId !== me.id)
    .sort((a, b) => new Date(b.items[b.items.length - 1].created_at) - new Date(a.items[a.items.length - 1].created_at));
  const viewGroup = viewing ? byUser.get(viewing.userId) : null;

  return (
    <div className={embedded ? 'embedded-panel' : 'modal-bg'} role="presentation">
      <section className="status-home">
        <button className="status-row" onClick={() => (mine ? setViewing({ userId: me.id, index: 0 }) : setComposing(true))}>
          <span className={`story-ring ${mine ? 'has' : 'none'}`}>
            <Avatar name={me.name} seed={me.id} />
            {!mine && <span className="story-plus"><I n="plus" /></span>}
          </span>
          <span className="status-row-text">
            <strong>My status</strong>
            <small>{mine ? `${mine.items.length} update${mine.items.length > 1 ? 's' : ''} · ${formatTime(mine.items[mine.items.length - 1].created_at)}` : 'Tap to add status update'}</small>
          </span>
        </button>
        <div className="status-add-row">
          <button onClick={() => { setKind('text'); setFile(null); setComposing(true); }} aria-label="Write a text status"><I n="pencil" /> Text</button>
          <button onClick={() => { setKind('image'); setComposing(true); setTimeout(() => fileRef.current?.click(), 50); }} aria-label="Post a photo status"><I n="camera" /> Photo</button>
          <button onClick={() => { setKind('video'); setComposing(true); setTimeout(() => fileRef.current?.click(), 50); }} aria-label="Post a video status"><I n="video" /> Video</button>
        </div>
        <h4 className="status-section">Recent updates</h4>
        {!others.length && <p className="status-empty">No updates from your friends yet.</p>}
        {others.map((g) => (
          <button key={g.userId} className="status-row" onClick={() => setViewing({ userId: g.userId, index: 0 })}>
            <span className="story-ring has"><Avatar name={g.name} seed={g.userId} /></span>
            <span className="status-row-text">
              <strong>{g.name}</strong>
              <small>{formatTime(g.items[g.items.length - 1].created_at)}</small>
            </span>
          </button>
        ))}
        {error && !composing && <p className="status-error">{error}</p>}
      </section>

      <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={chooseFile} />
      <input ref={songRef} type="file" accept="audio/*" hidden onChange={chooseSong} />

      {composing && (
        <div className="modal-bg" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setComposing(false)}>
          <section className="modal status-modal" role="dialog" aria-modal="true" aria-labelledby="status-title">
            <div className="modal-head"><h3 id="status-title">New status</h3><button className="icon-btn" onClick={() => setComposing(false)} aria-label="Close"><I n="close" /></button></div>
            <form className="status-form" onSubmit={postStatus}>
              <div className="status-kind-tabs" aria-label="Status type">
                <button type="button" className={kind === 'text' ? 'active' : ''} onClick={() => { setKind('text'); setFile(null); }}>Text</button>
                <button type="button" className={kind === 'image' ? 'active' : ''} onClick={() => { setKind('image'); fileRef.current?.click(); }}>Photo</button>
                <button type="button" className={kind === 'video' ? 'active' : ''} onClick={() => { setKind('video'); fileRef.current?.click(); }}>Video</button>
              </div>
              {kind === 'text' ? (
                <>
                  <textarea className="status-text-preview" style={{ background }} maxLength={700} placeholder="Type a status" value={body} onChange={(e) => setBody(e.target.value)} />
                  <div className="status-colors" aria-label="Text background">
                    {BACKGROUNDS.map((color) => <button key={color} type="button" aria-label={`Choose background ${color}`} className={background === color ? 'selected' : ''} style={{ background: color }} onClick={() => setBackground(color)} />)}
                  </div>
                </>
              ) : (
                <div className="status-file-picker">
                  <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>{file ? 'Choose a different file' : `Choose ${kind === 'video' ? 'video' : 'photo'}`}</button>
                  <span>{file ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB` : `Up to 50 MB`}</span>
                  {file && <input className="status-caption" maxLength={300} placeholder="Add a caption (optional)" value={body} onChange={(e) => setBody(e.target.value)} />}
                  {file && !song && <button type="button" className="btn-secondary" onClick={() => songRef.current?.click()}><I n="music" /> Add a song</button>}
                  {file && song && (
                    <div className="song-box">
                      <div className="song-head"><span><I n="music" /> {song.title}</span><button type="button" className="link-btn" onClick={removeSong}>Remove</button></div>
                      {song.duration > 1 && (
                        <label className="song-start">Starts at {Math.floor(songStart / 60)}:{String(Math.floor(songStart % 60)).padStart(2, '0')}
                          <input type="range" min="0" max={Math.max(0, Math.floor(song.duration) - 1)} step="1" value={songStart} onChange={(e) => { setSongStart(Number(e.target.value)); if (previewRef.current) previewRef.current.pause(); setPreviewing(false); }} />
                        </label>
                      )}
                      <button type="button" className="btn-secondary" onClick={togglePreview}>{previewing ? '⏸ Stop preview' : 'Preview from here'}</button>
                      <audio ref={previewRef} src={previewUrl} onEnded={() => setPreviewing(false)} />
                    </div>
                  )}
                </div>
              )}
              <div className="audience-pick" role="radiogroup" aria-label="Who can see this">
                <button type="button" role="radio" aria-checked={audience === 'everyone'} className={audience === 'everyone' ? 'active' : ''} onClick={() => setAudience('everyone')}>Everyone</button>
                <button type="button" role="radio" aria-checked={audience === 'inner'} className={audience === 'inner' ? 'active' : ''} onClick={() => setAudience('inner')}>Inner Orbit</button>
                {audience === 'inner' && <button type="button" className="link-btn" onClick={() => setShowOrbit(true)}>Edit who</button>}
              </div>
              <div className="status-form-foot"><span>{body.length}/{kind === 'text' ? 700 : 300}</span><button className="btn-primary status-post" disabled={busy || (kind === 'text' ? !body.trim() : !file)}>{busy ? 'Posting…' : 'Post status'}</button></div>
              {error && <p className="status-error">{error}</p>}
            </form>
          </section>
        </div>
      )}

      {editing && (
        <MediaEditor
          file={editing}
          doneLabel="Use photo "
          onCancel={() => setEditing(null)}
          onError={() => { setFile(editing); setEditing(null); }}
          onDone={(blob) => { setFile(new File([blob], 'status.jpg', { type: 'image/jpeg' })); setEditing(null); }}
        />
      )}

      {editingVideo && (
        <VideoEditor
          file={editingVideo}
          maxSeconds={60}
          doneLabel="Use video "
          onCancel={() => setEditingVideo(null)}
          onDone={({ blob, type, ext }) => {
            setFile(new File([blob], `status.${ext}`, { type }));
            setEditingVideo(null);
          }}
        />
      )}

      {showOrbit && <OrbitEditor me={me} people={people} onClose={() => setShowOrbit(false)} />}

      {viewGroup && (
        <StatusViewer
          group={viewGroup}
          start={viewing.index}
          isMine={viewGroup.userId === me.id}
          onClose={() => setViewing(null)}
          onDelete={removeStatus}
        />
      )}
    </div>
  );
}

// Full-screen story viewer: progress bars on top, tap left/right to move, auto-advance.
function StatusViewer({ group, start, isMine, onClose, onDelete }) {
  const [i, setI] = useState(start);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewers, setViewers] = useState([]); // people who looked at MY current status
  const [showViewers, setShowViewers] = useState(false);
  const marked = useRef(new Set());
  const items = group.items;
  const cur = items[Math.min(i, items.length - 1)];

  // Someone else's status: tell the poster I looked (once). My own status: load who looked.
  useEffect(() => {
    if (!cur) return undefined;
    if (!isMine) {
      if (!marked.current.has(cur.id)) {
        marked.current.add(cur.id);
        supabase.from('status_views').upsert({ status_id: cur.id }, { onConflict: 'status_id,viewer_id', ignoreDuplicates: true }).then(() => {}, () => {});
      }
      return undefined;
    }
    let alive = true;
    const loadViewers = async () => {
      const { data, error } = await supabase
        .from('status_views')
        .select('viewer_id, viewed_at, profiles(name)')
        .eq('status_id', cur.id)
        .order('viewed_at', { ascending: false });
      if (alive && !error && Array.isArray(data)) setViewers(data);
    };
    setViewers([]);
    loadViewers();
    const timer = setInterval(loadViewers, 8000);
    return () => { alive = false; clearInterval(timer); };
  }, [cur?.id, isMine]);

  const next = () => (i < items.length - 1 ? setI(i + 1) : onClose());
  const prev = () => setI(Math.max(0, i - 1));

  useEffect(() => {
    setProgress(0);
  }, [i]);

  // Photos and text last 6 seconds. Videos advance when they end.
  useEffect(() => {
    if (!cur || cur.kind === 'video' || paused || showViewers) return undefined;
    const started = Date.now() - progress * 6000;
    const t = setInterval(() => {
      const p = Math.min(1, (Date.now() - started) / 6000);
      setProgress(p);
      if (p >= 1) { clearInterval(t); next(); }
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, paused, showViewers, cur?.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  if (!cur) return null;
  return (
    <div className="story-view" role="dialog" aria-modal="true" aria-label={`${group.name} status`}>
      <div className="story-bars">
        {items.map((it, idx) => (
          <span key={it.id}><i style={{ width: `${idx < i ? 100 : idx === i ? progress * 100 : 0}%` }} /></span>
        ))}
      </div>
      <div className="story-top">
        <Avatar name={group.name === 'My status' ? 'Me' : group.name} seed={group.userId} small />
        <div className="story-who"><strong>{group.name}</strong><small>{formatTime(cur.created_at)} · {remaining(cur.expires_at)}{cur.audience === 'inner' ? ' · Inner Orbit' : ''}</small></div>
        {isMine && <button className="story-del" onClick={() => onDelete(cur)}>Delete</button>}
        <button className="icon-btn" onClick={onClose} aria-label="Close"><I n="close" /></button>
      </div>
      <div className="story-stage" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)}>
        {cur.kind === 'text' && <div className="story-text" style={{ background: cur.background || BACKGROUNDS[0] }}><p>{cur.body}</p></div>}
        {cur.kind === 'image' && (cur.media_url ? <img src={cur.media_url} alt="Status" /> : <p className="status-error">Media could not be loaded.</p>)}
        {cur.kind === 'video' && (cur.media_url ? <video src={cur.media_url} autoPlay playsInline controls muted={!!cur.audio_url} onEnded={next} /> : <p className="status-error">Media could not be loaded.</p>)}
        {cur.kind !== 'text' && cur.body && <div className="story-caption">{cur.body}</div>}
        {cur.audio_url && <StorySong key={cur.id} url={cur.audio_url} start={cur.audio_start || 0} title={cur.audio_title} paused={paused} />}
        <button className="story-tap left" aria-label="Previous" onClick={prev} />
        <button className="story-tap right" aria-label="Next" onClick={next} />
      </div>
      {isMine && (
        <button type="button" className="story-views" onClick={() => setShowViewers(true)} aria-label={`${viewers.length} views`}>
          <I n="eye" s={18} /> {viewers.length}
        </button>
      )}
      {isMine && showViewers && (
        <div className="viewers-sheet" role="dialog" aria-modal="true" aria-label="Viewed by">
          <div className="viewers-head">
            <strong><I n="eye" s={18} /> Viewed by {viewers.length}</strong>
            <button type="button" className="icon-btn" onClick={() => setShowViewers(false)} aria-label="Close"><I n="close" /></button>
          </div>
          <div className="viewers-list">
            {viewers.length === 0 && <p className="status-empty">No views yet. They appear here when people open your status.</p>}
            {viewers.map((v) => (
              <div key={v.viewer_id} className="viewer-row">
                <Avatar name={v.profiles?.name || 'Someone'} seed={v.viewer_id} small />
                <span className="viewer-name">{v.profiles?.name || 'Atomshade user'}</span>
                <small>{formatTime(v.viewed_at)}</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Plays the status's song (from the start point the poster chose) while the status is on screen.
function StorySong({ url, start, title, paused }) {
  const ref = useRef(null);
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    if (paused) a.pause();
    else a.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
  }, [paused]);
  return (
    <>
      <audio
        ref={ref}
        src={url}
        autoPlay
        loop
        muted={muted}
        onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = start; } catch { /* ignore */ } }}
      />
      <button
        type="button"
        className="story-song"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); if (blocked && ref.current) { ref.current.play(); setBlocked(false); } else setMuted((m) => !m); }}
        aria-label={muted ? 'Unmute song' : 'Mute song'}
      >
        {blocked ? 'Tap to play' : muted ? '' : ''} {title || 'Song'}
      </button>
    </>
  );
}
