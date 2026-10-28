-- Atomshade Settings update (privacy, disappearing messages, starred messages, blocked list).
-- Safe to run more than once. Run AFTER all the earlier update files.

-- ---------- 1. PRIVATE SETTINGS (only you can read or change yours) ----------
create table if not exists public.user_settings (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  read_receipts boolean not null default true,
  show_online   boolean not null default true,
  updated_at    timestamptz not null default now()
);
alter table public.user_settings enable row level security;
revoke all on public.user_settings from public, anon, authenticated;

create or replace function public.get_my_settings()
returns table (read_receipts boolean, show_online boolean)
language sql stable security definer set search_path = public
as $$
  select coalesce(s.read_receipts, true), coalesce(s.show_online, true)
  from (select 1) x
  left join public.user_settings s on s.user_id = auth.uid()
  where auth.uid() is not null;
$$;

create or replace function public.set_my_setting(p_field text, p_value boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if p_field not in ('read_receipts', 'show_online') or p_value is null then
    raise exception 'Unknown setting';
  end if;
  insert into public.user_settings (user_id, read_receipts, show_online)
  values (
    auth.uid(),
    case when p_field = 'read_receipts' then p_value else true end,
    case when p_field = 'show_online' then p_value else true end
  )
  on conflict (user_id) do update set
    read_receipts = case when p_field = 'read_receipts' then p_value else public.user_settings.read_receipts end,
    show_online   = case when p_field = 'show_online'   then p_value else public.user_settings.show_online end,
    updated_at    = now();
end;
$$;

-- Marking a chat as read: if you turned read receipts OFF, the other person's ticks stay grey.
-- (Your own unread badge still clears.)
create or replace function public.mark_conversation_read(conv uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_member(conv) then
    return;
  end if;

  update public.conversation_members
  set last_read_at = now()
  where conversation_id = conv and user_id = auth.uid();

  if not coalesce((select s.read_receipts from public.user_settings s where s.user_id = auth.uid()), true) then
    return;
  end if;

  update public.messages
  set read_at = now(), delivered_at = coalesce(delivered_at, now())
  where conversation_id = conv
    and sender_id <> auth.uid()
    and read_at is null
    and (deliver_at is null or deliver_at <= now())
    and exists (select 1 from public.conversations c where c.id = conv and not c.is_group);
end;
$$;

-- ---------- 2. BLOCKED PEOPLE LIST ----------
create or replace function public.my_blocked()
returns table (id uuid, name text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name
  from public.user_blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by p.name;
$$;

-- ---------- 3. DISAPPEARING MESSAGES ----------
alter table public.conversations
  add column if not exists disappear_secs integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_disappear_check') then
    alter table public.conversations
      add constraint conversations_disappear_check
      check (disappear_secs is null or disappear_secs in (86400, 604800, 7776000));
  end if;
end $$;

alter table public.messages add column if not exists expires_at timestamptz;
create index if not exists messages_expires_idx on public.messages (expires_at) where expires_at is not null;

-- Any member of a 1-on-1 chat, or an admin of a group, can set the timer. Only affects NEW messages.
create or replace function public.set_disappearing(p_conv uuid, p_secs integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  grp boolean;
  secs integer := nullif(p_secs, 0);
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if secs is not null and secs not in (86400, 604800, 7776000) then
    raise exception 'Choose 24 hours, 7 days or 90 days';
  end if;
  select c.is_group into grp from public.conversations c where c.id = p_conv;
  if grp is null or not public.is_member(p_conv) then
    raise exception 'You are not in this chat';
  end if;
  if grp and not exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conv and m.user_id = auth.uid() and m.role = 'admin'
  ) then
    raise exception 'Only a group admin can change disappearing messages';
  end if;
  update public.conversations set disappear_secs = secs where id = p_conv;
end;
$$;

-- Stamp every new message with the time it will vanish (counted from when it opens, for time capsules).
create or replace function public.messages_set_expiry()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  s integer;
begin
  select c.disappear_secs into s from public.conversations c where c.id = new.conversation_id;
  if s is not null then
    new.expires_at := coalesce(new.deliver_at, now()) + (s * interval '1 second');
  else
    new.expires_at := null;
  end if;
  return new;
end;
$$;

create or replace trigger trg_messages_expiry before insert on public.messages
  for each row execute function public.messages_set_expiry();

-- Expired messages can no longer be read by anyone (the clean-up job removes the rows soon after).
do $$
declare pol text;
begin
  foreach pol in array array['Users can view messages in their conversations.', 'read messages in my conversations'] loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = pol) then
      execute format(
        'alter policy %I on public.messages using (public.is_member(conversation_id) and (deliver_at is null or deliver_at <= now() or sender_id = auth.uid()) and (expires_at is null or expires_at > now()))',
        pol);
    end if;
  end loop;
end $$;

-- The chat list must ignore expired messages too.
create or replace function public.my_chat_list()
returns table (
  conversation_id uuid, is_group boolean, secret boolean, title text, real_title text, nickname text,
  archived boolean, locked boolean, other_id uuid, member_count bigint, last_body text, last_kind text,
  last_deleted boolean, last_e2ee boolean, last_at timestamptz, last_sender uuid, last_sender_name text,
  unread_count bigint, other_vibe text, other_vibe_until timestamptz
)
language sql stable security definer set search_path = public
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
         and (m.expires_at is null or m.expires_at > now())
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
      and (m2.expires_at is null or m2.expires_at > now())
    order by m2.sort_at desc
    limit 1
  ) lm on true
  order by coalesce(lm.sort_at, c.created_at) desc;
$$;

-- ---------- 4. STARRED MESSAGES (normal chats only; secret chats are never starred) ----------
create table if not exists public.starred_messages (
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.starred_messages enable row level security;
revoke all on public.starred_messages from public, anon;
grant select, insert, delete on public.starred_messages to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'starred_messages' and policyname = 'see my stars') then
    create policy "see my stars" on public.starred_messages for select to authenticated
      using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'starred_messages' and policyname = 'star a message I can see') then
    create policy "star a message I can see" on public.starred_messages for insert to authenticated
      with check (
        user_id = auth.uid()
        and exists (select 1 from public.messages m where m.id = message_id and not m.e2ee and not m.deleted_for_everyone)
      );
  end if;
end $$;

create or replace function public.my_starred()
returns table (
  message_id uuid, conversation_id uuid, chat_title text, is_group boolean, sender_id uuid, sender_name text,
  kind text, body text, media_path text, sent_at timestamptz, starred_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select m.id, m.conversation_id,
         coalesce(cp.nickname, case when c.is_group then c.name else o.name end),
         c.is_group, m.sender_id, sp.name, m.kind, m.body, m.media_path, m.sort_at, s.created_at
  from public.starred_messages s
  join public.messages m on m.id = s.message_id
  join public.conversations c on c.id = m.conversation_id
  left join public.chat_prefs cp on cp.conversation_id = c.id and cp.user_id = auth.uid()
  left join public.profiles sp on sp.id = m.sender_id
  left join lateral (
    select p.name
    from public.conversation_members om
    join public.profiles p on p.id = om.user_id
    where om.conversation_id = c.id and om.user_id <> auth.uid() and not c.is_group
    limit 1
  ) o on true
  where s.user_id = auth.uid()
    and public.is_member(m.conversation_id)
    and not m.e2ee
    and not m.deleted_for_everyone
    and (m.expires_at is null or m.expires_at > now())
    and (m.deliver_at is null or m.deliver_at <= now() or m.sender_id = auth.uid())
  order by s.created_at desc
  limit 300;
$$;

-- ---------- 5. WHO CAN CALL WHAT ----------
grant execute on function public.get_my_settings() to authenticated;
grant execute on function public.set_my_setting(text, boolean) to authenticated;
grant execute on function public.my_blocked() to authenticated;
grant execute on function public.set_disappearing(uuid, integer) to authenticated;
grant execute on function public.my_starred() to authenticated;
revoke execute on function public.get_my_settings(), public.set_my_setting(text, boolean), public.my_blocked(),
  public.set_disappearing(uuid, integer), public.my_starred(), public.mark_conversation_read(uuid),
  public.my_chat_list() from public, anon;
grant execute on function public.mark_conversation_read(uuid), public.my_chat_list() to authenticated;
revoke execute on function public.messages_set_expiry() from public, anon, authenticated;
