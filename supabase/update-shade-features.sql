-- =====================================================================
-- ATOMSHADE SIGNATURE FEATURES (run once, in Supabase -> SQL Editor)
--
-- Run it AFTER update-security.sql. It is safe to run again.
--
--   1. Throw Shade     anonymous messages inside a group of friends
--   2. Inner Orbit     choose who can see your status (everyone, or only your inner circle)
--   3. Time Capsule    schedule a message to arrive at a future time
--   4. Secret chats    end-to-end encrypted one-to-one chats (the server stores only scrambled text)
--   5. Reports         report a message so the owner can review it
-- =====================================================================

do $$
begin
  if to_regprocedure('public.can_send_in(uuid)') is null then
    raise exception 'Please run update-security.sql first, then run this file again.';
  end if;
end $$;

-- ---------- A. MESSAGE COLUMNS (time capsules + encryption) ----------
alter table public.messages add column if not exists deliver_at timestamptz;
alter table public.messages add column if not exists e2ee boolean not null default false;
alter table public.messages add column if not exists sort_at timestamptz
  generated always as (coalesce(deliver_at, created_at)) stored;
create index if not exists messages_conv_sort_idx on public.messages (conversation_id, sort_at);

alter table public.conversations add column if not exists secret boolean not null default false;
alter table public.conversations drop constraint if exists conversations_secret_not_group;
alter table public.conversations add constraint conversations_secret_not_group check (not (secret and is_group));

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  (deleted_for_everyone = true and body is null and media_path is null)
  or (kind = 'text' and body is not null
      and char_length(body) between 1 and (case when e2ee then 12000 else 4000 end))
  or (kind in ('image', 'audio') and media_path is not null and not e2ee)
);

revoke insert on public.messages from authenticated;
grant insert (conversation_id, kind, body, media_path, duration_ms, reply_to, e2ee, deliver_at)
  on public.messages to authenticated;

-- A time capsule is invisible to everyone but its sender until its time comes.
drop policy if exists "read messages in my conversations" on public.messages;
create policy "read messages in my conversations" on public.messages
  for select to authenticated
  using (
    public.is_member(conversation_id)
    and (deliver_at is null or deliver_at <= now() or sender_id = auth.uid())
  );

drop policy if exists "mark received messages delivered or read" on public.messages;
create policy "mark received messages delivered or read" on public.messages
  for update to authenticated
  using (
    public.is_member(conversation_id) and sender_id <> auth.uid()
    and (deliver_at is null or deliver_at <= now())
  );

-- Checks every new message: secret chats take only encrypted text, normal chats never do,
-- and time capsules must be in the future (but not too far, and not too many).
create or replace function public.messages_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  sec boolean;
begin
  select secret into sec from public.conversations where id = new.conversation_id;
  if coalesce(sec, false) then
    if not new.e2ee or new.kind <> 'text' then
      raise exception 'Secret chats only accept encrypted text messages';
    end if;
  elsif new.e2ee then
    raise exception 'Encrypted messages belong only in secret chats';
  end if;

  if new.deliver_at is not null then
    if new.kind <> 'text' then raise exception 'Only text messages can be time capsules'; end if;
    if new.deliver_at < now() + interval '30 seconds' then
      raise exception 'A time capsule needs a time in the future';
    end if;
    if new.deliver_at > now() + interval '366 days' then
      raise exception 'A time capsule can be at most one year ahead';
    end if;
    if (select count(*) from public.messages
        where sender_id = new.sender_id and deliver_at > now()) >= 20 then
      raise exception 'You can have up to 20 time capsules waiting';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_messages_guard on public.messages;
create trigger trg_messages_guard before insert on public.messages
  for each row execute function public.messages_guard();

-- Delete for everyone: within one hour. A time capsule that has not arrived yet can be
-- cancelled at any time (it is removed completely, so nobody ever knew it existed).
create or replace function public.delete_message_for_everyone(message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.messages%rowtype;
begin
  select * into target from public.messages where id = message_id;
  if not found then raise exception 'Message not found'; end if;
  if target.sender_id <> auth.uid() then raise exception 'You can only delete your own messages'; end if;
  if not public.is_member(target.conversation_id) then raise exception 'You are not a member of this chat'; end if;

  if target.deliver_at is not null and target.deliver_at > now() then
    delete from public.messages where id = message_id;
    return;
  end if;
  if coalesce(target.deliver_at, target.created_at) < now() - interval '1 hour' then
    raise exception 'Messages can only be deleted for everyone within one hour';
  end if;
  if target.media_path is not null then
    delete from storage.objects where bucket_id = 'chat-media' and name = target.media_path;
  end if;
  update public.messages
    set body = null, media_path = null, duration_ms = null,
        deleted_for_everyone = true, deleted_at = now(), kind = 'text'
    where id = message_id;
end;
$$;

create or replace function public.mark_conversation_read(conv uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_member(conv) then
    return;
  end if;

  update public.conversation_members
  set last_read_at = now()
  where conversation_id = conv and user_id = auth.uid();

  update public.messages
  set read_at = now(), delivered_at = coalesce(delivered_at, now())
  where conversation_id = conv
    and sender_id <> auth.uid()
    and read_at is null
    and (deliver_at is null or deliver_at <= now())
    and exists (select 1 from public.conversations c where c.id = conv and not c.is_group);
end;
$$;

-- ---------- B. SECRET CHATS (END-TO-END ENCRYPTION) ----------
-- Each person's phone makes a key pair. The PUBLIC half is stored here (it is meant to be public).
-- The private half never leaves the phone, except as an optional backup that is locked
-- with a password only the person knows.
create table if not exists public.public_keys (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  public_key text not null check (char_length(public_key) between 20 and 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.public_keys enable row level security;
revoke all on public.public_keys from anon, authenticated;
grant select on public.public_keys to authenticated;
drop policy if exists "public keys are readable" on public.public_keys;
create policy "public keys are readable" on public.public_keys
  for select to authenticated using (true);

create table if not exists public.key_backups (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  wrapped    text not null check (char_length(wrapped) between 20 and 6000),
  salt       text not null check (char_length(salt) between 8 and 200),
  iv         text not null check (char_length(iv) between 8 and 200),
  iterations integer not null check (iterations between 100000 and 5000000),
  updated_at timestamptz not null default now()
);
alter table public.key_backups enable row level security;
revoke all on public.key_backups from anon, authenticated;

-- Save my public key. Returns 'created', 'same', 'replaced', or 'exists' (a different key is
-- already on file: restore your backup, or choose to start over).
create or replace function public.register_public_key(p_key text, p_replace boolean default false)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  cur text;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if p_key is null or char_length(p_key) < 20 or char_length(p_key) > 400 then
    raise exception 'That key does not look right';
  end if;
  select public_key into cur from public.public_keys where user_id = auth.uid();
  if cur is null then
    insert into public.public_keys (user_id, public_key) values (auth.uid(), p_key);
    return 'created';
  end if;
  if cur = p_key then return 'same'; end if;
  if p_replace then
    update public.public_keys set public_key = p_key, updated_at = now() where user_id = auth.uid();
    return 'replaced';
  end if;
  return 'exists';
end;
$$;

create or replace function public.get_public_key(p_user uuid)
returns text
language sql
security definer stable
set search_path = public
as $$
  select public_key from public.public_keys where user_id = p_user and auth.uid() is not null;
$$;

create or replace function public.save_key_backup(p_wrapped text, p_salt text, p_iv text, p_iterations integer)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  insert into public.key_backups (user_id, wrapped, salt, iv, iterations)
  values (auth.uid(), p_wrapped, p_salt, p_iv, p_iterations)
  on conflict (user_id) do update
    set wrapped = excluded.wrapped, salt = excluded.salt, iv = excluded.iv,
        iterations = excluded.iterations, updated_at = now();
end;
$$;

create or replace function public.get_key_backup()
returns table (wrapped text, salt text, iv text, iterations integer)
language sql
security definer stable
set search_path = public
as $$
  select k.wrapped, k.salt, k.iv, k.iterations from public.key_backups k where k.user_id = auth.uid();
$$;

create or replace function public.delete_key_backup()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.key_backups where user_id = auth.uid();
$$;

-- Normal one-to-one chats never reuse a secret chat.
create or replace function public.create_or_get_dm(other uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  conv uuid;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if other is null or other = auth.uid() then
    raise exception 'You cannot chat with yourself';
  end if;
  if not exists (select 1 from public.profiles where id = other) then
    raise exception 'Person not found';
  end if;
  if public.is_blocked_between(auth.uid(), other) then
    raise exception 'You cannot message this person';
  end if;

  select a.conversation_id into conv
  from public.conversation_members a
  join public.conversation_members b on a.conversation_id = b.conversation_id
  join public.conversations c on c.id = a.conversation_id and not c.is_group and not c.secret
  where a.user_id = auth.uid() and b.user_id = other
  limit 1;

  if conv is null then
    insert into public.conversations default values returning id into conv;
    insert into public.conversation_members (conversation_id, user_id)
    values (conv, auth.uid()), (conv, other);
  end if;

  return conv;
end;
$$;

create or replace function public.create_or_get_secret_dm(other uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  conv uuid;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if other is null or other = auth.uid() then
    raise exception 'You cannot chat with yourself';
  end if;
  if not exists (select 1 from public.profiles where id = other) then
    raise exception 'Person not found';
  end if;
  if public.is_blocked_between(auth.uid(), other) then
    raise exception 'You cannot message this person';
  end if;
  if not exists (select 1 from public.public_keys where user_id = auth.uid()) then
    raise exception 'Your secret-chat keys are not ready yet. Refresh the page and try again.';
  end if;
  if not exists (select 1 from public.public_keys where user_id = other) then
    raise exception 'This person has not opened the updated Atomshade yet. Ask them to open it once, then try again.';
  end if;

  select a.conversation_id into conv
  from public.conversation_members a
  join public.conversation_members b on a.conversation_id = b.conversation_id
  join public.conversations c on c.id = a.conversation_id and c.secret and not c.is_group
  where a.user_id = auth.uid() and b.user_id = other
  limit 1;

  if conv is null then
    insert into public.conversations (secret) values (true) returning id into conv;
    insert into public.conversation_members (conversation_id, user_id)
    values (conv, auth.uid()), (conv, other);
  end if;

  return conv;
end;
$$;

-- ---------- C. THE CHAT LIST ----------
drop function if exists public.my_chats();

create function public.my_chats()
returns table (
  conversation_id   uuid,
  is_group          boolean,
  secret            boolean,
  title             text,
  other_id          uuid,
  member_count      bigint,
  last_body         text,
  last_kind         text,
  last_deleted      boolean,
  last_e2ee         boolean,
  last_at           timestamptz,
  last_sender       uuid,
  last_sender_name  text,
  unread_count      bigint,
  other_vibe        text,
  other_vibe_until  timestamptz
)
language sql
security definer stable
set search_path = public
as $$
  select
    c.id,
    c.is_group,
    c.secret,
    case when c.is_group then c.name else o.name end,
    o.id,
    (select count(*) from public.conversation_members x where x.conversation_id = c.id),
    lm.body,
    lm.kind,
    coalesce(lm.deleted, false),
    coalesce(lm.e2ee, false),
    lm.sort_at,
    lm.sender_id,
    lm.sender_name,
    (select count(*) from public.messages m
       where m.conversation_id = c.id
         and m.sender_id <> auth.uid()
         and not m.deleted_for_everyone
         and m.sort_at > me.last_read_at
         and m.sort_at <= now()),
    case when o.vibe_until > now() then o.vibe else null end,
    case when o.vibe_until > now() then o.vibe_until else null end
  from public.conversations c
  join public.conversation_members me
    on me.conversation_id = c.id and me.user_id = auth.uid()
  left join lateral (
    select p.id, p.name, p.vibe, p.vibe_until
    from public.conversation_members om
    join public.profiles p on p.id = om.user_id
    where om.conversation_id = c.id and om.user_id <> auth.uid() and not c.is_group
    limit 1
  ) o on true
  left join lateral (
    select m2.body, m2.kind, m2.deleted_for_everyone as deleted, m2.e2ee,
           m2.sort_at, m2.sender_id, sp.name as sender_name
    from public.messages m2
    left join public.profiles sp on sp.id = m2.sender_id
    where m2.conversation_id = c.id
      and (m2.deliver_at is null or m2.deliver_at <= now() or m2.sender_id = auth.uid())
    order by m2.sort_at desc
    limit 1
  ) lm on true
  order by coalesce(lm.sort_at, c.created_at) desc;
$$;

-- ---------- D. INNER ORBIT (who can see my status) ----------
create table if not exists public.close_friends (
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  friend_id  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, friend_id),
  check (owner_id <> friend_id)
);
alter table public.close_friends enable row level security;
revoke all on public.close_friends from anon, authenticated;
grant select on public.close_friends to authenticated;
drop policy if exists "see my inner orbit" on public.close_friends;
create policy "see my inner orbit" on public.close_friends
  for select to authenticated using (owner_id = auth.uid());

create or replace function public.is_in_orbit_of(owner uuid)
returns boolean
language sql
security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.close_friends where owner_id = owner and friend_id = auth.uid()
  );
$$;

create or replace function public.set_inner_orbit(p_friends uuid[])
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ids uuid[];
begin
  if uid is null then raise exception 'Please log in first'; end if;
  select coalesce(array_agg(distinct p.id), '{}') into ids
  from public.profiles p
  where p.id = any(coalesce(p_friends, '{}')) and p.id <> uid
    and not public.is_blocked_between(uid, p.id);
  if coalesce(array_length(ids, 1), 0) > 100 then
    raise exception 'Your inner orbit can have up to 100 people';
  end if;
  delete from public.close_friends where owner_id = uid and not (friend_id = any(ids));
  insert into public.close_friends (owner_id, friend_id)
  select uid, x from unnest(ids) x
  on conflict do nothing;
  return coalesce(array_length(ids, 1), 0);
end;
$$;

alter table public.statuses add column if not exists audience text not null default 'everyone';
alter table public.statuses drop constraint if exists statuses_audience_check;
alter table public.statuses add constraint statuses_audience_check check (audience in ('everyone', 'inner'));

revoke insert on public.statuses from authenticated;
grant insert (user_id, body, kind, media_path, background, audience) on public.statuses to authenticated;

drop policy if exists "read unexpired statuses" on public.statuses;
create policy "read unexpired statuses" on public.statuses
  for select to authenticated
  using (
    expires_at > now()
    and (audience = 'everyone' or user_id = auth.uid() or public.is_in_orbit_of(user_id))
  );

-- ---------- E. THROW SHADE (anonymous messages inside a group) ----------
-- Nobody can read these tables directly. Everything goes through the functions below, which
-- never show the receiver who sent a shade. (Moderators can see it in a report.)
create table if not exists public.shade_threads (
  id              uuid primary key default gen_random_uuid(),
  circle_id       uuid not null references public.conversations(id) on delete cascade,
  starter_id      uuid not null references public.profiles(id) on delete cascade,
  target_id       uuid not null references public.profiles(id) on delete cascade,
  closed          boolean not null default false,
  starter_read_at timestamptz not null default now(),
  target_read_at  timestamptz not null default 'epoch',
  created_at      timestamptz not null default now(),
  unique (circle_id, starter_id, target_id),
  check (starter_id <> target_id)
);
create table if not exists public.shade_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.shade_threads(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create table if not exists public.shade_blocks (
  target_id      uuid not null references public.profiles(id) on delete cascade,
  hidden_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (target_id, hidden_user_id)
);
create index if not exists shade_messages_thread_idx on public.shade_messages (thread_id, created_at);
create index if not exists shade_threads_target_idx on public.shade_threads (target_id);
create index if not exists shade_threads_starter_idx on public.shade_threads (starter_id);

alter table public.shade_threads  enable row level security;
alter table public.shade_messages enable row level security;
alter table public.shade_blocks   enable row level security;
revoke all on public.shade_threads  from anon, authenticated;
revoke all on public.shade_messages from anon, authenticated;
revoke all on public.shade_blocks   from anon, authenticated;

create or replace function public.send_shade(p_circle uuid, p_target uuid, p_body text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  b   text := trim(coalesce(p_body, ''));
  t   uuid;
  was_closed boolean;
begin
  if uid is null then raise exception 'Please log in first'; end if;
  if char_length(b) < 1 then raise exception 'Write something first'; end if;
  if char_length(b) > 500 then raise exception 'That is too long (500 characters at most)'; end if;
  if p_target is null or p_target = uid then raise exception 'Pick someone else'; end if;

  if not exists (select 1 from public.conversations c where c.id = p_circle and c.is_group) then
    raise exception 'Shades work inside group chats';
  end if;
  if not public.is_member(p_circle) then raise exception 'You are not in that group'; end if;
  if not exists (select 1 from public.conversation_members
                 where conversation_id = p_circle and user_id = p_target) then
    raise exception 'That person is not in this group';
  end if;
  if (select count(*) from public.conversation_members where conversation_id = p_circle) < 3 then
    raise exception 'Shades need a group of at least 3 people, so nobody can guess who sent it';
  end if;
  if public.is_blocked_between(uid, p_target)
     or exists (select 1 from public.shade_blocks where target_id = p_target and hidden_user_id = uid) then
    raise exception 'Could not send this shade';
  end if;

  if (select count(*) from public.shade_messages sm
      join public.shade_threads st on st.id = sm.thread_id
      where sm.author_id = uid and st.starter_id = uid
        and sm.created_at > now() - interval '1 day') >= 15 then
    raise exception 'You have sent many shades today. Try again tomorrow.';
  end if;
  if (select count(*) from public.shade_messages sm
      join public.shade_threads st on st.id = sm.thread_id
      where sm.author_id = uid and st.starter_id = uid and st.target_id = p_target
        and sm.created_at > now() - interval '1 day') >= 3 then
    raise exception 'That is enough shade for one person today.';
  end if;

  select id, closed into t, was_closed
  from public.shade_threads
  where circle_id = p_circle and starter_id = uid and target_id = p_target;
  if t is null then
    insert into public.shade_threads (circle_id, starter_id, target_id)
    values (p_circle, uid, p_target) returning id into t;
  elsif was_closed then
    raise exception 'Could not send this shade';
  end if;

  insert into public.shade_messages (thread_id, author_id, body) values (t, uid, b);
  update public.shade_threads set starter_read_at = now() where id = t;
  return t;
end;
$$;

create or replace function public.reply_shade(p_thread uuid, p_body text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  b   text := trim(coalesce(p_body, ''));
  th  public.shade_threads%rowtype;
begin
  if uid is null then raise exception 'Please log in first'; end if;
  if char_length(b) < 1 then raise exception 'Write something first'; end if;
  if char_length(b) > 500 then raise exception 'That is too long (500 characters at most)'; end if;
  select * into th from public.shade_threads where id = p_thread;
  if not found or (th.starter_id <> uid and th.target_id <> uid) then
    raise exception 'Shade not found';
  end if;
  if th.closed then raise exception 'This shade was closed'; end if;
  -- Blocks and group membership only ever stop the HIDDEN person. They never change what the
  -- receiver can do, so the receiver can not use them to test who the hidden person is.
  if uid = th.starter_id then
    if public.is_blocked_between(uid, th.target_id)
       or exists (select 1 from public.shade_blocks
                  where target_id = th.target_id and hidden_user_id = uid)
       or not exists (select 1 from public.conversation_members
                      where conversation_id = th.circle_id and user_id = uid)
       or not exists (select 1 from public.conversation_members
                      where conversation_id = th.circle_id and user_id = th.target_id) then
      raise exception 'This shade was closed';
    end if;
    if (select count(*) from public.shade_messages
        where thread_id = p_thread and author_id = uid
          and created_at > now() - interval '1 day') >= 20 then
      raise exception 'That is enough shade for one person today.';
    end if;
  end if;
  if (select count(*) from public.shade_messages
      where author_id = uid and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'You are replying too fast. Please wait a moment.';
  end if;
  insert into public.shade_messages (thread_id, author_id, body) values (p_thread, uid, b);
  if uid = th.starter_id then
    update public.shade_threads set starter_read_at = now() where id = p_thread;
  else
    update public.shade_threads set target_read_at = now() where id = p_thread;
  end if;
end;
$$;

create or replace function public.my_shade_threads()
returns table (
  thread_id   uuid,
  circle_id   uuid,
  circle_name text,
  i_am        text,
  other_name  text,
  last_body   text,
  last_at     timestamptz,
  last_mine   boolean,
  unread      boolean,
  closed      boolean
)
language sql
security definer stable
set search_path = public
as $$
  select
    t.id,
    t.circle_id,
    c.name,
    case when t.target_id = auth.uid() then 'target' else 'starter' end,
    case when t.starter_id = auth.uid() then p.name else null end,
    lm.body,
    date_trunc('minute', lm.created_at),
    (lm.author_id = auth.uid()),
    case when t.target_id = auth.uid()
      then exists (select 1 from public.shade_messages m
                   where m.thread_id = t.id and m.author_id = t.starter_id and m.created_at > t.target_read_at)
      else exists (select 1 from public.shade_messages m
                   where m.thread_id = t.id and m.author_id = t.target_id and m.created_at > t.starter_read_at)
    end,
    t.closed
  from public.shade_threads t
  join public.conversations c on c.id = t.circle_id
  left join public.profiles p on p.id = t.target_id
  join lateral (
    select m2.body, m2.created_at, m2.author_id
    from public.shade_messages m2 where m2.thread_id = t.id
    order by m2.created_at desc limit 1
  ) lm on true
  where t.starter_id = auth.uid() or t.target_id = auth.uid()
  order by lm.created_at desc
  limit 100;
$$;

-- The messages of one shade. The receiver never learns who the hidden person is.
create or replace function public.shade_thread_messages(p_thread uuid)
returns table (id uuid, body text, created_at timestamptz, mine boolean, hidden boolean)
language sql
security definer stable
set search_path = public
as $$
  -- the newest 300, oldest first; times are rounded to the minute so they can not be matched to activity
  select x.id, x.body, date_trunc('minute', x.created_at), x.mine, x.hidden
  from (
    select m.id, m.body, m.created_at,
           (m.author_id = auth.uid()) as mine,
           (t.target_id = auth.uid() and m.author_id = t.starter_id) as hidden
    from public.shade_threads t
    join public.shade_messages m on m.thread_id = t.id
    where t.id = p_thread and (t.starter_id = auth.uid() or t.target_id = auth.uid())
    order by m.created_at desc
    limit 300
  ) x
  order by x.created_at;
$$;

create or replace function public.mark_shade_read(p_thread uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.shade_threads
  set starter_read_at = case when starter_id = auth.uid() then now() else starter_read_at end,
      target_read_at  = case when target_id  = auth.uid() then now() else target_read_at end
  where id = p_thread and (starter_id = auth.uid() or target_id = auth.uid());
$$;

-- Close a shade. The receiver can also stop this hidden person from sending them any more.
create or replace function public.close_shade_thread(p_thread uuid, p_block boolean default false)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  th public.shade_threads%rowtype;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into th from public.shade_threads where id = p_thread;
  if not found or (th.starter_id <> auth.uid() and th.target_id <> auth.uid()) then
    raise exception 'Shade not found';
  end if;
  update public.shade_threads set closed = true where id = p_thread;
  if p_block and th.target_id = auth.uid() then
    insert into public.shade_blocks (target_id, hidden_user_id) values (th.target_id, th.starter_id)
    on conflict do nothing;
  end if;
end;
$$;

-- Report a shade you received. The text is copied from the database (so it cannot be faked),
-- the shade is closed and the sender can not send you shades again.
create or replace function public.report_shade(p_thread uuid, p_message uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  th public.shade_threads%rowtype;
  m  public.shade_messages%rowtype;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into th from public.shade_threads where id = p_thread;
  if not found or th.target_id <> auth.uid() then raise exception 'Shade not found'; end if;
  select * into m from public.shade_messages where id = p_message and thread_id = p_thread;
  if not found or m.author_id <> th.starter_id then raise exception 'Message not found'; end if;
  if (select count(*) from public.reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have sent many reports today. Please try again tomorrow.';
  end if;
  if not exists (select 1 from public.reports where reporter_id = auth.uid() and kind = 'shade' and ref_id = p_message) then
    insert into public.reports (reporter_id, reported_id, kind, ref_id, reason, evidence, evidence_verified)
    values (auth.uid(), th.starter_id, 'shade', p_message, left(coalesce(p_reason, ''), 500), m.body, true);
  end if;
  update public.shade_threads set closed = true where id = p_thread;
  insert into public.shade_blocks (target_id, hidden_user_id) values (th.target_id, th.starter_id)
  on conflict do nothing;
end;
$$;

-- ---------- F. REPORT A MESSAGE ----------
-- For normal chats the text is copied from the database. For secret chats the server cannot
-- read the message, so the reporter's phone sends the readable text; it is marked "unverified".
create or replace function public.report_message(p_message uuid, p_reason text default null, p_plaintext text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  m public.messages%rowtype;
  ev text;
  verified boolean := true;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into m from public.messages where id = p_message;
  if not found or not public.is_member(m.conversation_id) or m.sender_id = auth.uid()
     or (m.deliver_at is not null and m.deliver_at > now()) then
    raise exception 'Message not found';
  end if;
  if m.deleted_for_everyone then raise exception 'That message was already deleted'; end if;
  if (select count(*) from public.reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have sent many reports today. Please try again tomorrow.';
  end if;
  if exists (select 1 from public.reports where reporter_id = auth.uid() and kind = 'message' and ref_id = p_message) then
    return;
  end if;
  if m.e2ee then
    ev := left(coalesce(p_plaintext, ''), 4000);
    verified := false;
  elsif m.kind = 'text' then
    ev := m.body;
  else
    ev := '[' || m.kind || '] ' || coalesce(m.media_path, '');
  end if;
  insert into public.reports (reporter_id, reported_id, kind, ref_id, reason, evidence, evidence_verified)
  values (auth.uid(), m.sender_id, 'message', p_message, left(coalesce(p_reason, ''), 500), ev, verified);
end;
$$;

-- ---------- G. LOCK THE DOORS (again, for the new functions) ----------
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.cleanup_expired_statuses() from authenticated;
