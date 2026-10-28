-- =====================================================================
-- ATOMSHADE UPDATE v0.7.1: security and correctness fixes
--
-- Run this ONCE, after schema.sql, update-v0.4.sql, update-v0.5.sql and update-v0.6.sql.
-- Supabase -> SQL Editor -> New query -> paste everything -> Run.
-- It is safe to run again.
-- =====================================================================

-- ---------- 0. SAFETY CHECK: the earlier updates must be in place first ----------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'deleted_for_everyone'
  ) or to_regclass('public.statuses') is null then
    raise exception 'Please run update-v0.5.sql first, then run this file again.';
  end if;
  if to_regclass('public.channel_members') is null or to_regclass('public.community_members') is null then
    raise exception 'Please run update-v0.6.sql first, then run this file again.';
  end if;
end $$;

-- ---------- 1. NOBODY CAN REWRITE SOMEONE ELSE'S MESSAGE ----------
-- Before this, the other person in a chat could change ANY part of your message
-- (its text, its sender, anything). Now the only things a logged-in user can edit
-- directly are the "delivered" and "read" times. Deleting still works through
-- delete_message_for_everyone(), which checks that you are the sender.

revoke update on public.messages from authenticated;
revoke update on public.messages from anon;
grant update (delivered_at, read_at) on public.messages to authenticated;

-- ---------- 2. THE CHAT LIST UNDERSTANDS DELETED MESSAGES ----------
-- Before this, a deleted last message showed up as "null" in the chat list and
-- still counted as unread.

drop function if exists public.my_chats();

create function public.my_chats()
returns table (
  conversation_id  uuid,
  is_group         boolean,
  title            text,
  other_id         uuid,
  other_email      text,
  member_count     bigint,
  last_body        text,
  last_kind        text,
  last_deleted     boolean,
  last_at          timestamptz,
  last_sender      uuid,
  last_sender_name text,
  unread_count     bigint
)
language sql
security definer stable
set search_path = public
as $$
  select
    c.id,
    c.is_group,
    case when c.is_group then c.name else o.name end,
    o.id,
    o.email,
    (select count(*) from public.conversation_members x where x.conversation_id = c.id),
    lm.body,
    lm.kind,
    coalesce(lm.deleted, false),
    lm.created_at,
    lm.sender_id,
    lm.sender_name,
    (select count(*) from public.messages m
       where m.conversation_id = c.id
         and m.sender_id <> auth.uid()
         and not m.deleted_for_everyone
         and m.created_at > me.last_read_at)
  from public.conversations c
  join public.conversation_members me
    on me.conversation_id = c.id and me.user_id = auth.uid()
  left join lateral (
    select p.id, p.name, p.email
    from public.conversation_members om
    join public.profiles p on p.id = om.user_id
    where om.conversation_id = c.id and om.user_id <> auth.uid() and not c.is_group
    limit 1
  ) o on true
  left join lateral (
    select m2.body, m2.kind, m2.deleted_for_everyone as deleted,
           m2.created_at, m2.sender_id, sp.name as sender_name
    from public.messages m2
    left join public.profiles sp on sp.id = m2.sender_id
    where m2.conversation_id = c.id
    order by m2.created_at desc
    limit 1
  ) lm on true
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- ---------- 3. STATUS CANNOT BE MADE TO LAST FOREVER ----------
-- People choose what a status says, never when it expires.

revoke insert on public.statuses from authenticated;
revoke insert on public.statuses from anon;
grant insert (user_id, body, kind, media_path, background) on public.statuses to authenticated;

-- ---------- 4. CHANNELS AND COMMUNITIES: REAL ADMINS ----------
-- Before this: anyone could make themselves an admin by inserting role = 'admin',
-- and ANY follower could publish in ANY channel (so a channel was just a free-for-all).
-- Now: whoever creates a channel is its admin, followers can only read, and only
-- admins can publish.

create or replace function public.is_channel_admin(ch uuid)
returns boolean
language sql
security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.channel_members
    where channel_id = ch and user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_community_admin(comm uuid)
returns boolean
language sql
security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.community_members
    where community_id = comm and user_id = auth.uid() and role = 'admin'
  );
$$;

-- Repair data made by the old rules: creators must be admins, and nobody else is.
insert into public.channel_members (channel_id, user_id, role)
select c.id, c.creator_id, 'admin' from public.channels c
on conflict (channel_id, user_id) do update set role = 'admin';

update public.channel_members m set role = 'member'
from public.channels c
where c.id = m.channel_id and m.role = 'admin' and m.user_id <> c.creator_id;

insert into public.community_members (community_id, user_id, role)
select c.id, c.creator_id, 'admin' from public.communities c
on conflict (community_id, user_id) do update set role = 'admin';

update public.community_members m set role = 'member'
from public.communities c
where c.id = m.community_id and m.role = 'admin' and m.user_id <> c.creator_id;

-- Creating a channel or community now goes through these functions, so the creator
-- is always added as its admin in one step.
create or replace function public.create_channel(p_name text, p_description text default null)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  ch uuid;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 1 then raise exception 'Give the channel a name'; end if;
  if (select count(*) from public.channels where creator_id = auth.uid()) >= 10 then
    raise exception 'You can create up to 10 channels';
  end if;
  insert into public.channels (name, description, creator_id)
  values (trim(p_name), nullif(trim(coalesce(p_description, '')), ''), auth.uid())
  returning id into ch;
  insert into public.channel_members (channel_id, user_id, role) values (ch, auth.uid(), 'admin');
  return ch;
end;
$$;

create or replace function public.create_community(p_name text, p_description text default null)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  comm uuid;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 1 then raise exception 'Give the community a name'; end if;
  if (select count(*) from public.communities where creator_id = auth.uid()) >= 10 then
    raise exception 'You can create up to 10 communities';
  end if;
  insert into public.communities (name, description, creator_id)
  values (trim(p_name), nullif(trim(coalesce(p_description, '')), ''), auth.uid())
  returning id into comm;
  insert into public.community_members (community_id, user_id, role) values (comm, auth.uid(), 'admin');
  return comm;
end;
$$;

-- Follower and member counts for the Explore screen (names stay private).
create or replace function public.explore_counts()
returns table (kind text, id uuid, members bigint)
language sql
security definer stable
set search_path = public
as $$
  select 'channel'::text, channel_id, count(*) from public.channel_members group by channel_id
  union all
  select 'community'::text, community_id, count(*) from public.community_members group by community_id;
$$;

-- Direct inserts into channels / communities are closed; use the functions above.
revoke insert on public.channels from authenticated;
revoke insert on public.communities from authenticated;
drop policy if exists "create channel as self" on public.channels;
drop policy if exists "create community as self" on public.communities;

-- Memberships: you can join as a plain member only, and you can see your own memberships
-- (admins can also see their channel's follower list). Admins cannot just walk away and
-- leave a channel with nobody in charge.
drop policy if exists "read channel memberships" on public.channel_members;
drop policy if exists "join channel as self" on public.channel_members;
drop policy if exists "leave channel as self" on public.channel_members;
drop policy if exists "read my channel memberships" on public.channel_members;
create policy "read my channel memberships" on public.channel_members
  for select to authenticated using (user_id = auth.uid() or public.is_channel_admin(channel_id));
drop policy if exists "follow a channel as a member" on public.channel_members;
create policy "follow a channel as a member" on public.channel_members
  for insert to authenticated with check (user_id = auth.uid() and role = 'member');
drop policy if exists "unfollow a channel" on public.channel_members;
create policy "unfollow a channel" on public.channel_members
  for delete to authenticated using (user_id = auth.uid() and role = 'member');

drop policy if exists "read community memberships" on public.community_members;
drop policy if exists "join community as self" on public.community_members;
drop policy if exists "leave community as self" on public.community_members;
drop policy if exists "read my community memberships" on public.community_members;
create policy "read my community memberships" on public.community_members
  for select to authenticated using (user_id = auth.uid() or public.is_community_admin(community_id));
drop policy if exists "join a community as a member" on public.community_members;
create policy "join a community as a member" on public.community_members
  for insert to authenticated with check (user_id = auth.uid() and role = 'member');
drop policy if exists "leave a community" on public.community_members;
create policy "leave a community" on public.community_members
  for delete to authenticated using (user_id = auth.uid() and role = 'member');

-- Posts: followers read, admins publish and can remove posts.
drop policy if exists "publish in followed channels" on public.channel_posts;
drop policy if exists "admins delete channel posts" on public.channel_posts;
drop policy if exists "admins publish in their channels" on public.channel_posts;
create policy "admins publish in their channels" on public.channel_posts
  for insert to authenticated
  with check (author_id = auth.uid() and public.is_channel_admin(channel_id));
create policy "admins delete channel posts" on public.channel_posts
  for delete to authenticated using (public.is_channel_admin(channel_id));

revoke insert on public.channel_posts from authenticated;
grant insert (channel_id, author_id, body) on public.channel_posts to authenticated;
grant delete on public.channel_posts to authenticated;

-- Only signed-in users may call the new functions.
revoke all on function public.create_channel(text, text) from public;
revoke all on function public.create_community(text, text) from public;
revoke all on function public.explore_counts() from public;
revoke all on function public.is_channel_admin(uuid) from public;
revoke all on function public.is_community_admin(uuid) from public;
revoke execute on function public.create_channel(text, text) from anon;
revoke execute on function public.create_community(text, text) from anon;
revoke execute on function public.explore_counts() from anon;
revoke execute on function public.is_channel_admin(uuid) from anon;
revoke execute on function public.is_community_admin(uuid) from anon;
grant execute on function public.create_channel(text, text) to authenticated;
grant execute on function public.create_community(text, text) to authenticated;
grant execute on function public.explore_counts() to authenticated;
grant execute on function public.is_channel_admin(uuid) to authenticated;
grant execute on function public.is_community_admin(uuid) to authenticated;

-- ---------- 5. CALLS: A SAFE WAY TO RING SOMEONE ----------
-- Voice and video calls need a way to ring the other person wherever they are in the app.
-- A call is a row in this table. Only the database can create or change it (through the two
-- functions below), so nobody can pretend to be someone else, ring a stranger, or end a call
-- that is not theirs. The audio and video themselves go directly between the two phones or
-- computers; they never touch the database.

create table if not exists public.calls (
  id           uuid primary key default gen_random_uuid(),
  caller_id    uuid not null references public.profiles(id) on delete cascade,
  callee_id    uuid not null references public.profiles(id) on delete cascade,
  media        text not null check (media in ('audio', 'video')),
  status       text not null default 'ringing'
               check (status in ('ringing', 'accepted', 'declined', 'cancelled', 'missed', 'ended')),
  created_at   timestamptz not null default now(),
  answered_at  timestamptz,
  ended_at     timestamptz,
  check (caller_id <> callee_id)
);

create index if not exists calls_callee_idx on public.calls (callee_id, created_at desc);
create index if not exists calls_caller_idx on public.calls (caller_id, created_at desc);

alter table public.calls enable row level security;

drop policy if exists "see my calls" on public.calls;
create policy "see my calls" on public.calls
  for select to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid());

revoke all on public.calls from anon;
revoke insert, update, delete on public.calls from authenticated;
grant select on public.calls to authenticated;

-- Start a call. You can only call someone you have a 1-on-1 chat with.
create or replace function public.start_call(p_callee uuid, p_media text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  cid uuid;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if p_callee is null or p_callee = auth.uid() then raise exception 'You cannot call yourself'; end if;
  if p_media not in ('audio', 'video') then raise exception 'Unknown call type'; end if;

  if not exists (
    select 1
    from public.conversation_members a
    join public.conversation_members b on b.conversation_id = a.conversation_id
    join public.conversations c on c.id = a.conversation_id and not c.is_group
    where a.user_id = auth.uid() and b.user_id = p_callee
  ) then
    raise exception 'You can only call people you have a chat with';
  end if;

  -- Anything still ringing from this caller is finished.
  update public.calls set status = 'cancelled', ended_at = now()
  where caller_id = auth.uid() and status = 'ringing';

  insert into public.calls (caller_id, callee_id, media)
  values (auth.uid(), p_callee, p_media)
  returning id into cid;

  return cid;
end;
$$;

-- Answer, decline, end or mark a call as missed. Returns what the call's status is afterwards.
--   accept : the person being called answers (only while it is still ringing)
--   decline: the person being called says no
--   end    : either person hangs up (before it is answered, this means cancelled or declined)
--   missed : the caller gives up after nobody answered
create or replace function public.update_call(p_call uuid, p_action text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  c public.calls%rowtype;
  uid uuid := auth.uid();
begin
  select * into c from public.calls where id = p_call for update;
  if not found or uid is null or (c.caller_id <> uid and c.callee_id <> uid) then
    raise exception 'Call not found';
  end if;
  if p_action not in ('accept', 'decline', 'end', 'missed') then
    raise exception 'Unknown action';
  end if;

  if p_action = 'accept' then
    if c.callee_id <> uid then raise exception 'Only the person being called can answer'; end if;
    if c.status = 'ringing' and c.created_at > now() - interval '2 minutes' then
      update public.calls set status = 'accepted', answered_at = now() where id = c.id;
      return 'accepted';
    end if;
    return c.status;

  elsif p_action = 'decline' then
    if c.callee_id <> uid then raise exception 'Only the person being called can decline'; end if;
    if c.status = 'ringing' then
      update public.calls set status = 'declined', ended_at = now() where id = c.id;
      return 'declined';
    end if;
    return c.status;

  elsif p_action = 'missed' then
    if c.caller_id <> uid then raise exception 'Only the caller can mark a call as missed'; end if;
    if c.status = 'ringing' then
      update public.calls set status = 'missed', ended_at = now() where id = c.id;
      return 'missed';
    end if;
    return c.status;

  else -- end
    if c.status = 'ringing' then
      if c.caller_id = uid then
        update public.calls set status = 'cancelled', ended_at = now() where id = c.id;
        return 'cancelled';
      end if;
      update public.calls set status = 'declined', ended_at = now() where id = c.id;
      return 'declined';
    elsif c.status = 'accepted' then
      update public.calls set status = 'ended', ended_at = now() where id = c.id;
      return 'ended';
    end if;
    return c.status;
  end if;
end;
$$;

revoke all on function public.start_call(uuid, text) from public;
revoke all on function public.update_call(uuid, text) from public;
revoke execute on function public.start_call(uuid, text) from anon;
revoke execute on function public.update_call(uuid, text) from anon;
grant execute on function public.start_call(uuid, text) to authenticated;
grant execute on function public.update_call(uuid, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.calls;
exception when duplicate_object then null;
end $$;
