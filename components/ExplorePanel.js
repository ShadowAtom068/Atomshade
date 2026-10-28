'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const NEEDS_UPDATE = 'This feature needs the latest database update. Run update-v0.7.1-fixes.sql in Supabase (see UPDATE-v0.7.1.md).';

function friendly(err) {
  if (!err) return '';
  if (err.code === 'PGRST202') return NEEDS_UPDATE;
  return err.message || 'Something went wrong. Please try again.';
}

// Channels (one-way updates from admins) and Communities (a list of people who joined).
export default function ExplorePanel({ me, onClose, embedded = false }) {
  const [tab, setTab] = useState('channels');
  const [channels, setChannels] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [counts, setCounts] = useState({}); // 'channel:<id>' -> number
  const [chanRoles, setChanRoles] = useState({}); // channel id -> 'admin' | 'member'
  const [commRoles, setCommRoles] = useState({});
  const [selected, setSelected] = useState(null);
  const [posts, setPosts] = useState([]);
  const [postBody, setPostBody] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isChannels = tab === 'channels';

  const load = useCallback(async () => {
    const [c, cm, fm, mm, ct] = await Promise.all([
      supabase.from('channels').select('id,name,description,creator_id,created_at').order('created_at', { ascending: false }),
      supabase.from('communities').select('id,name,description,creator_id,created_at').order('created_at', { ascending: false }),
      supabase.from('channel_members').select('channel_id, role').eq('user_id', me.id),
      supabase.from('community_members').select('community_id, role').eq('user_id', me.id),
      supabase.rpc('explore_counts'),
    ]);
    const firstError = c.error || cm.error || fm.error || mm.error;
    if (firstError) setError(friendly(firstError));
    setChannels(c.data || []);
    setCommunities(cm.data || []);
    setChanRoles(Object.fromEntries((fm.data || []).map((x) => [x.channel_id, x.role])));
    setCommRoles(Object.fromEntries((mm.data || []).map((x) => [x.community_id, x.role])));
    // explore_counts is optional: without it we just do not show numbers.
    setCounts(Object.fromEntries((ct.data || []).map((x) => [`${x.kind}:${x.id}`, Number(x.members)])));
  }, [me.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (embedded) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, embedded]);

  const loadPosts = useCallback(async (channelId) => {
    const { data, error: postError } = await supabase
      .from('channel_posts')
      .select('id,body,created_at,author_id,profiles(name)')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (postError) setError(friendly(postError));
    else setPosts(data || []);
  }, []);

  // Live updates while a channel is open
  useEffect(() => {
    if (!selected) return undefined;
    const ch = supabase
      .channel(`channel-posts:${selected.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_posts', filter: `channel_id=eq.${selected.id}` }, () =>
        loadPosts(selected.id)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [selected, loadPosts]);

  async function openChannel(channel) {
    setError('');
    setPosts([]);
    setSelected(channel);
    loadPosts(channel.id);
  }

  async function createItem(e) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    const fn = isChannels ? 'create_channel' : 'create_community';
    const { error: createError } = await supabase.rpc(fn, {
      p_name: name.trim(),
      p_description: description.trim() || null,
    });
    setBusy(false);
    if (createError) {
      setError(friendly(createError));
      return;
    }
    setName('');
    setDescription('');
    setShowCreate(false);
    load();
  }

  async function join(item) {
    const table = isChannels ? 'channel_members' : 'community_members';
    const key = isChannels ? 'channel_id' : 'community_id';
    const { error: joinError } = await supabase.from(table).insert({ [key]: item.id, user_id: me.id, role: 'member' });
    if (joinError && joinError.code !== '23505') setError(friendly(joinError));
    load();
  }

  async function leave(item) {
    const table = isChannels ? 'channel_members' : 'community_members';
    const key = isChannels ? 'channel_id' : 'community_id';
    const { error: leaveError } = await supabase.from(table).delete().eq(key, item.id).eq('user_id', me.id);
    if (leaveError) setError(friendly(leaveError));
    load();
  }

  async function publishPost(e) {
    e.preventDefault();
    if (!selected || !postBody.trim() || busy) return;
    setBusy(true);
    setError('');
    const { error: postError } = await supabase
      .from('channel_posts')
      .insert({ channel_id: selected.id, author_id: me.id, body: postBody.trim() });
    setBusy(false);
    if (postError) {
      setError(friendly(postError));
      return;
    }
    setPostBody('');
    loadPosts(selected.id);
  }

  async function deletePost(id) {
    if (!confirm('Delete this update?')) return;
    const { error: delError } = await supabase.from('channel_posts').delete().eq('id', id);
    if (delError) setError(friendly(delError));
    else loadPosts(selected.id);
  }

  function switchTab(next) {
    setTab(next);
    setSelected(null);
    setShowCreate(false);
    setError('');
  }

  const list = isChannels ? channels : communities;
  const roles = isChannels ? chanRoles : commRoles;
  const countOf = (item) => counts[`${isChannels ? 'channel' : 'community'}:${item.id}`];
  const selectedIsAdmin = selected && chanRoles[selected.id] === 'admin';

  return (
    <div className={embedded ? 'embedded-panel' : 'modal-bg'} onClick={embedded ? undefined : onClose}>
      <section className="modal explore-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>Channels &amp; Communities</h3>
          {!embedded && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </header>
        <p className="modal-sub">Discover channels and communities, follow updates, and connect around shared interests.</p>

        <div className="explore-tabs">
          <button className={isChannels ? 'active' : ''} onClick={() => switchTab('channels')}>
            📢 Channels
          </button>
          <button className={!isChannels ? 'active' : ''} onClick={() => switchTab('communities')}>
            👥 Communities
          </button>
        </div>

        {selected && isChannels ? (
          <>
            <div className="explore-selected">
              <button onClick={() => setSelected(null)}>← Back</button>
              <div>
                <strong>{selected.name}</strong>
                <p>{selected.description || 'Channel updates'}</p>
              </div>
            </div>

            {selectedIsAdmin ? (
              <form className="channel-post-form" onSubmit={publishPost}>
                <textarea
                  value={postBody}
                  onChange={(e) => setPostBody(e.target.value)}
                  maxLength={3000}
                  placeholder="Share an update with followers…"
                />
                <button className="primary-btn" disabled={busy || !postBody.trim()}>
                  {busy ? 'Posting…' : 'Publish'}
                </button>
              </form>
            ) : (
              <p className="modal-sub">Only the channel admins can post here.</p>
            )}

            <div className="explore-list">
              {posts.map((p) => (
                <article className="explore-card" key={p.id}>
                  <div className="explore-card-head">
                    <strong>{p.profiles?.name || 'Atomshade user'}</strong>
                    <time>{new Date(p.created_at).toLocaleString()}</time>
                  </div>
                  <p>{p.body}</p>
                  {selectedIsAdmin && (
                    <div className="explore-card-foot">
                      <button onClick={() => deletePost(p.id)}>Delete</button>
                    </div>
                  )}
                </article>
              ))}
              {posts.length === 0 && <div className="status-empty">No updates yet.</div>}
            </div>
          </>
        ) : (
          <>
            <div className="explore-actions">
              <span>
                {list.length} {tab}
              </span>
              <button className="primary-btn" onClick={() => setShowCreate((v) => !v)}>
                ＋ Create {isChannels ? 'channel' : 'community'}
              </button>
            </div>

            {showCreate && (
              <form className="explore-create" onSubmit={createItem}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={isChannels ? 'Channel name' : 'Community name'}
                  maxLength={80}
                  required
                />
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description (optional)"
                  maxLength={500}
                />
                <div>
                  <button type="button" onClick={() => setShowCreate(false)}>
                    Cancel
                  </button>
                  <button className="primary-btn" disabled={busy || !name.trim()}>
                    {busy ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </form>
            )}

            <div className="explore-list">
              {list.map((item) => {
                const role = roles[item.id];
                const n = countOf(item);
                return (
                  <article className="explore-card" key={item.id}>
                    <div className="explore-card-head">
                      <div className="explore-icon">{isChannels ? '📢' : '👥'}</div>
                      <div className="explore-card-title">
                        <strong>{item.name}</strong>
                        <p>{item.description || 'No description yet.'}</p>
                        {n !== undefined && (
                          <p>
                            {n} {isChannels ? (n === 1 ? 'follower' : 'followers') : n === 1 ? 'member' : 'members'}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="explore-card-foot">
                      {role ? (
                        <>
                          <span className="explore-joined">
                            {role === 'admin' ? 'Admin' : isChannels ? 'Following' : 'Joined'}
                          </span>
                          {isChannels && <button onClick={() => openChannel(item)}>Open</button>}
                          {role !== 'admin' && <button onClick={() => leave(item)}>{isChannels ? 'Unfollow' : 'Leave'}</button>}
                        </>
                      ) : (
                        <>
                          {isChannels && <button onClick={() => openChannel(item)}>Preview</button>}
                          <button className="primary-btn" onClick={() => join(item)}>
                            {isChannels ? 'Follow' : 'Join'}
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
              {list.length === 0 && <div className="status-empty">Nothing here yet. Be the first to create one.</div>}
            </div>
          </>
        )}

        {error && <p className="status-error">{error}</p>}
        <footer className="modal-foot">
          <small>Channels and communities</small>
        </footer>
      </section>
    </div>
  );
}
