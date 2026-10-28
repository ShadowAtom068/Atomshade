-- =====================================================================
-- ATOMSHADE CHAT OPTIONS (run once, in Supabase -> SQL Editor)
-- Run it AFTER update-shade-features.sql. Safe to run again.
--
--   1. Your own name for a chat or contact (only you see it)
--   2. Archive a chat (moves it out of the main list)
--   3. Lock a chat (hides it in a "Locked chats" folder opened with a PIN on your device)
--   4. Group admins can rename the group for everyone
-- =====================================================================

do $$
begin
  if to_regprocedure('public.create_or_get_secret_dm(uuid)') is null then
    raise exception 'Please run update-shade-features.sql first, then run this file again.';
  end if;
end $$;

-- Quiet a security warning on an older helper function.
alter function public.is_member(uuid) set search_path = public;

create table if not exists public.chat_prefs (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  nickname        text check (nickname is null or char_length(nickname) between 1 and 40),
  archived        boolean not null default false,
  locked          boolean not null default false,
  updated_at      timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table public.chat_prefs enable row level security;
revoke all on public.chat_prefs from anon, authenticated;   -- only the functions below touch it

-- field: 'nickname' (p_text, empty = remove), 'archived' or 'locked' (p_bool)
create or replace function public.set_chat_pref(p_conv uuid, p_field text, p_text text default null, p_bool boolean default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  nick text := nullif(trim(coalesce(p_text, '')), '');
begin
  if uid is null then raise exception 'Please log in first'; end if;
  if not public.is_member(p_conv) then raise exception 'Chat not found'; end if;
  if p_field not in ('nickname', 'archived', 'locked') then raise exception 'Unknown option'; end if;
  if p_field = 'nickname' and nick is not null and char_length(nick) > 40 then
    raise exception 'That name is too long (40 characters at most)';
  end if;
  if p_field in ('archived', 'locked') and p_bool is null then raise exception 'Missing value'; end if;

  insert into public.chat_prefs (user_id, conversation_id) values (uid, p_conv)
  on conflict do nothing;

  if p_field = 'nickname' then
    update public.chat_prefs set nickname = nick, updated_at = now() where user_id = uid and conversation_id = p_conv;
  elsif p_field = 'archived' then
    update public.chat_prefs set archived = p_bool, updated_at = now() where user_id = uid and conversation_id = p_conv;
  else
    update public.chat_prefs set locked = p_bool, updated_at = now() where user_id = uid and conversation_id = p_conv;
  end if;
end;
$$;

-- Group admins can change the group's name for everyone.
create or replace function public.rename_group(p_conv uuid, p_name text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  n text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if char_length(n) < 2 then raise exception 'Group name is too short'; end if;
  if char_length(n) > 60 then raise exception 'Group name is too long'; end if;
  if not exists (
    select 1 from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id and c.is_group
    where m.conversation_id = p_conv and m.user_id = auth.uid() and m.role = 'admin'
  ) then
    raise exception 'Only a group admin can rename the group';
  end if;
  update public.conversations set name = n where id = p_conv;
end;
$$;

-- The chat list, with your own names, archive and lock settings.
create or replace function public.my_chat_list()
returns table (
  conversation_id   uuid,
  is_group          boolean,
  secret            boolean,
  title             text,
  real_title        text,
  nickname          text,
  archived          boolean,
  locked            boolean,
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
    coalesce(cp.nickname, case when c.is_group then c.name else o.name end),
    case when c.is_group then c.name else o.name end,
    cp.nickname,
    coalesce(cp.archived, false),
    coalesce(cp.locked, false),
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
  left join public.chat_prefs cp
    on cp.conversation_id = c.id and cp.user_id = auth.uid()
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

grant execute on function public.set_chat_pref(uuid, text, text, boolean) to authenticated;
grant execute on function public.rename_group(uuid, text) to authenticated;
grant execute on function public.my_chat_list() to authenticated;

revoke execute on function public.set_chat_pref(uuid, text, text, boolean), public.rename_group(uuid, text), public.my_chat_list() from public, anon;
