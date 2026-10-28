-- =====================================================================
-- ATOMSHADE SECURITY HARDENING (run once, in Supabase -> SQL Editor)
--
-- Run it AFTER schema.sql, update-v0.4 / v0.5 / v0.6, update-v0.7.1-fixes
-- and update-phone-numbers. It is safe to run again.
--
-- What this does, in plain words:
--   1. Hides every person's email and phone number from other users. People are
--      found through a search that only matches a full phone number or email.
--   2. Stops anyone from editing anything on their profile except name, about,
--      phone and vibe (nobody can fake an email or an id).
--   3. Adds Block and Report (also required by Google Play).
--   4. Adds speed limits: no one can flood messages, statuses or channel posts.
--   5. Closes the few doors that were open: no raw inserts of fake timestamps,
--      only safe file types in chat storage, no database functions for logged-out users.
-- =====================================================================

-- ---------- 0. SAFETY CHECK ----------
do $$
begin
  if to_regclass('public.calls') is null then
    raise exception 'Please run update-v0.7.1-fixes.sql first, then run this file again.';
  end if;
end $$;

-- ---------- 1. PROFILES: PRIVATE COLUMNS, LIMITED EDITING ----------
alter table public.profiles add column if not exists phone      text;
alter table public.profiles add column if not exists vibe       text;
alter table public.profiles add column if not exists vibe_until timestamptz;

alter table public.profiles drop constraint if exists profiles_name_len;
alter table public.profiles add constraint profiles_name_len
  check (name is null or char_length(name) <= 40) not valid;

alter table public.profiles drop constraint if exists profiles_about_len;
alter table public.profiles add constraint profiles_about_len
  check (about is null or char_length(about) <= 100) not valid;

alter table public.profiles drop constraint if exists profiles_phone_format;
alter table public.profiles add constraint profiles_phone_format
  check (phone is null or phone ~ '^[0-9]{7,15}$') not valid;

alter table public.profiles drop constraint if exists profiles_vibe_list;
alter table public.profiles add constraint profiles_vibe_list
  check (vibe is null or vibe in ('free','busy','sleeping','studying','out','need_laugh','gaming','music')) not valid;

create index if not exists profiles_phone_idx on public.profiles (phone);

-- Other people may read only these columns. Email and phone are NOT among them.
revoke all on public.profiles from anon;
revoke select on public.profiles from authenticated;
grant select (id, name, about, vibe, vibe_until, created_at) on public.profiles to authenticated;

-- You may edit only these columns of your own profile (vibe goes through set_vibe below).
revoke insert, delete on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant update (name, about, phone) on public.profiles to authenticated;

-- Your own full profile (including your email and phone).
create or replace function public.my_profile()
returns table (
  id uuid, email text, name text, about text, phone text,
  vibe text, vibe_until timestamptz, created_at timestamptz
)
language sql
security definer stable
set search_path = public
as $$
  select p.id, p.email, p.name, p.about, p.phone, p.vibe, p.vibe_until, p.created_at
  from public.profiles p
  where p.id = auth.uid();
$$;

-- Set your "vibe" (a mood shown next to your name). It fades by itself after a few hours.
create or replace function public.set_vibe(p_vibe text, p_hours integer default 12)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if p_vibe is null or p_vibe = '' then
    update public.profiles set vibe = null, vibe_until = null where id = auth.uid();
    return;
  end if;
  if p_vibe not in ('free','busy','sleeping','studying','out','need_laugh','gaming','music') then
    raise exception 'Unknown vibe';
  end if;
  update public.profiles
  set vibe = p_vibe, vibe_until = now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 12), 48)))
  where id = auth.uid();
end;
$$;

-- ---------- 2. BLOCKING ----------
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon, authenticated;
grant select on public.user_blocks to authenticated;
drop policy if exists "see my blocks" on public.user_blocks;
create policy "see my blocks" on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
security definer stable
set search_path = public
as $$
  -- Only answers for yourself: nobody can ask whether two OTHER people blocked each other.
  select auth.uid() is not null and auth.uid() in (a, b) and exists (
    select 1 from public.user_blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function public.block_user(p_user uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if p_user is null or p_user = auth.uid() then raise exception 'You cannot block yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Person not found'; end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (auth.uid(), p_user)
  on conflict do nothing;
end;
$$;

create or replace function public.unblock_user(p_user uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  delete from public.user_blocks where blocker_id = auth.uid() and blocked_id = p_user;
end;
$$;

-- Find people. Names match partly (at least 2 letters). A phone number or an email only
-- matches when it is typed IN FULL, so nobody can browse or collect other people's contacts.
create or replace function public.search_people(p_query text)
returns table (id uuid, name text, about text, vibe text, vibe_until timestamptz)
language plpgsql
security definer stable
set search_path = public
as $$
declare
  q      text := lower(trim(coalesce(p_query, '')));
  digits text := regexp_replace(lower(trim(coalesce(p_query, ''))), '[^0-9]', '', 'g');
  pat    text;
begin
  if auth.uid() is null or char_length(q) < 2 or char_length(q) > 80 then
    return;
  end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select p.id, p.name, p.about,
           case when p.vibe_until > now() then p.vibe else null end,
           case when p.vibe_until > now() then p.vibe_until else null end
    from public.profiles p
    where p.id <> auth.uid()
      and p.name is not null
      and not exists (select 1 from public.user_blocks b
                      where b.blocker_id = p.id and b.blocked_id = auth.uid())
      and (
        lower(p.name) like pat escape '\'
        or lower(p.email) = q
        or (char_length(digits) >= 7 and p.phone is not null and right(p.phone, 10) = right(digits, 10))
      )
    order by p.name
    limit 30;
end;
$$;

-- May I send messages in this conversation? (member, and in a 1-on-1 chat, not blocked either way)
create or replace function public.can_send_in(conv uuid)
returns boolean
language sql
security definer stable
set search_path = public
as $$
  select public.is_member(conv)
     and not exists (
       select 1
       from public.conversations c
       join public.conversation_members o on o.conversation_id = c.id and o.user_id <> auth.uid()
       where c.id = conv and not c.is_group
         and public.is_blocked_between(auth.uid(), o.user_id)
     );
$$;

-- ---------- 3. REPORTS (only the owner can read them, in the Supabase dashboard) ----------
create table if not exists public.reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid references public.profiles(id) on delete set null,
  reported_id       uuid references public.profiles(id) on delete set null,
  kind              text not null check (kind in ('user', 'message', 'shade', 'status')),
  ref_id            uuid,
  reason            text check (reason is null or char_length(reason) <= 500),
  evidence          text check (evidence is null or char_length(evidence) <= 12000),
  evidence_verified boolean not null default false,
  status            text not null default 'open' check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at        timestamptz not null default now()
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;   -- no policy, no grant: invisible to the app

create or replace function public.report_user(p_user uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if p_user is null or p_user = auth.uid() then raise exception 'You cannot report yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Person not found'; end if;
  if (select count(*) from public.reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have sent many reports today. Please try again tomorrow.';
  end if;
  insert into public.reports (reporter_id, reported_id, kind, ref_id, reason)
  values (auth.uid(), p_user, 'user', p_user, left(coalesce(p_reason, ''), 500));
end;
$$;

-- ---------- 4. SPEED LIMITS ----------
create index if not exists messages_sender_created_idx on public.messages (sender_id, created_at desc);

create or replace function public.rate_limit_messages()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (select count(*) from public.messages
      where sender_id = new.sender_id and created_at > now() - interval '10 seconds') >= 20 then
    raise exception 'You are sending messages too fast. Please slow down.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_messages_rate on public.messages;
create trigger trg_messages_rate before insert on public.messages
  for each row execute function public.rate_limit_messages();

create or replace function public.rate_limit_statuses()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (select count(*) from public.statuses
      where user_id = new.user_id and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'You have posted many statuses today. Please try again later.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_statuses_rate on public.statuses;
create trigger trg_statuses_rate before insert on public.statuses
  for each row execute function public.rate_limit_statuses();

create or replace function public.rate_limit_channel_posts()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (select count(*) from public.channel_posts
      where author_id = new.author_id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'You are posting too fast. Please wait a little.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_channel_posts_rate on public.channel_posts;
create trigger trg_channel_posts_rate before insert on public.channel_posts
  for each row execute function public.rate_limit_channel_posts();

-- ---------- 5. MESSAGES: ONLY THE SAFE COLUMNS CAN BE WRITTEN ----------
-- Before this, someone could insert a message with a fake time or pre-set "read" marks.
revoke insert on public.messages from authenticated;
revoke insert on public.messages from anon;
grant insert (conversation_id, kind, body, media_path, duration_ms, reply_to) on public.messages to authenticated;

drop policy if exists "send messages as myself" on public.messages;
create policy "send messages as myself" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.can_send_in(conversation_id));

-- A photo or voice note must live in the folder of its own chat.
alter table public.messages drop constraint if exists messages_media_path_in_chat;
alter table public.messages add constraint messages_media_path_in_chat
  check (media_path is null or media_path like conversation_id::text || '/%') not valid;

-- ---------- 6. CHAT STORAGE: ONLY PHOTOS AND VOICE NOTES ----------
update storage.buckets
set allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif',
      'audio/*'
    ],
    file_size_limit = 10485760,
    public = false
where id = 'chat-media';

-- Status photos and videos: real image / video types only (no SVG or other active content).
update storage.buckets
set allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif',
      'video/mp4', 'video/webm', 'video/quicktime'
    ]
where id = 'status-media';

-- One phone number belongs to one account (if two accounts had the same number, the later one loses it).
update public.profiles p set phone = null
where p.phone is not null
  and p.id <> (select p2.id from public.profiles p2 where p2.phone = p.phone order by p2.created_at, p2.id limit 1);
create unique index if not exists profiles_phone_unique on public.profiles (phone) where phone is not null;

-- ---------- 7. SAFER FUNCTIONS ----------
-- A 1-on-1 chat can not be started with someone who blocked you (or whom you blocked).
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
  join public.conversations c on c.id = a.conversation_id and not c.is_group
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

-- Groups: at most 50 people, at most 10 new groups a day, and people who blocked you
-- (or whom you blocked) are not added.
create or replace function public.create_group(group_name text, member_ids uuid[])
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  conv uuid;
  uid  uuid := auth.uid();
begin
  if uid is null then raise exception 'Please log in first'; end if;
  if char_length(trim(coalesce(group_name, ''))) < 2 then
    raise exception 'Group name is too short';
  end if;
  if char_length(trim(group_name)) > 60 then
    raise exception 'Group name is too long';
  end if;
  if coalesce(array_length(member_ids, 1), 0) < 1 then
    raise exception 'Pick at least one person';
  end if;
  if array_length(member_ids, 1) > 50 then
    raise exception 'A group can have up to 50 people';
  end if;
  if (select count(*) from public.conversations
      where created_by = uid and is_group and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You have created many groups today. Please try again tomorrow.';
  end if;

  insert into public.conversations (is_group, name, created_by)
  values (true, trim(group_name), uid)
  returning id into conv;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (conv, uid, 'admin');

  insert into public.conversation_members (conversation_id, user_id)
  select conv, p.id
  from public.profiles p
  where p.id = any(member_ids) and p.id <> uid
    and not public.is_blocked_between(uid, p.id)
  on conflict do nothing;

  return conv;
end;
$$;

-- Calls: not to someone you blocked, and at most 10 calls a minute.
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
  if public.is_blocked_between(auth.uid(), p_callee) then
    raise exception 'You cannot call this person';
  end if;
  if (select count(*) from public.calls
      where caller_id = auth.uid() and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Too many calls. Please wait a moment.';
  end if;

  update public.calls set status = 'cancelled', ended_at = now()
  where caller_id = auth.uid() and status = 'ringing';

  insert into public.calls (caller_id, callee_id, media)
  values (auth.uid(), p_callee, p_media)
  returning id into cid;

  return cid;
end;
$$;

-- ---------- 8. LOCK THE DOORS ----------
-- Tables nobody should write to directly (only through the functions above).
revoke insert, update, delete on public.conversations from authenticated;
revoke insert, update, delete on public.conversation_members from authenticated;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Logged-out visitors can not run any database function. Logged-in people can.
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.cleanup_expired_statuses() from authenticated;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- ---------- 9. WHO TO CALL ABOUT THIS ----------
comment on table public.reports is 'Open this table in the Supabase dashboard (Table Editor) to review reports.';
