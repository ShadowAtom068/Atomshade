-- =====================================================================
-- ATOMSHADE UPDATE v0.4: group chats, photos, voice notes
--
-- If you ALREADY ran schema.sql: run this file once.
-- If this is a brand new Supabase project: run schema.sql first, then this file.
--
-- Supabase -> SQL Editor -> New query -> paste everything -> Run
-- =====================================================================

-- ---------- 1. GROUPS ----------

alter table public.conversations
  add column if not exists is_group   boolean not null default false,
  add column if not exists name       text,
  add column if not exists created_by uuid references public.profiles(id);

alter table public.conversation_members
  add column if not exists role         text not null default 'member',
  add column if not exists last_read_at timestamptz not null default now();

-- ---------- 2. PHOTO + VOICE NOTE MESSAGES ----------

alter table public.messages
  add column if not exists kind        text not null default 'text',
  add column if not exists media_path  text,
  add column if not exists duration_ms integer;

alter table public.messages alter column body drop not null;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages drop constraint if exists messages_kind_check;

alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'image', 'audio'));

alter table public.messages add constraint messages_content_check check (
  (kind = 'text' and body is not null and char_length(body) between 1 and 4000)
  or (kind in ('image', 'audio') and media_path is not null)
);

-- ---------- 3. PRIVATE STORAGE FOR PHOTOS + VOICE NOTES ----------
-- Files live in a private bucket. Each file sits in a folder named after its
-- conversation, and only members of that conversation can upload or open it.

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-media', 'chat-media', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "members upload chat media" on storage.objects;
drop policy if exists "members read chat media" on storage.objects;

create policy "members upload chat media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

create policy "members read chat media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

-- ---------- 4. FUNCTIONS ----------

-- Start (or reopen) a 1-on-1 chat. Now ignores group chats.
create or replace function public.create_or_get_dm(other uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  conv uuid;
begin
  if other = auth.uid() then
    raise exception 'You cannot chat with yourself';
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

-- Create a group. The creator becomes its admin.
create or replace function public.create_group(group_name text, member_ids uuid[])
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  conv uuid;
  uid  uuid := auth.uid();
begin
  if char_length(trim(coalesce(group_name, ''))) < 2 then
    raise exception 'Group name is too short';
  end if;
  if coalesce(array_length(member_ids, 1), 0) < 1 then
    raise exception 'Pick at least one person';
  end if;
  if array_length(member_ids, 1) > 255 then
    raise exception 'Too many members';
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
  on conflict do nothing;

  return conv;
end;
$$;

-- Leave a group.
create or replace function public.leave_group(conv uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.conversations where id = conv and is_group) then
    raise exception 'This is not a group';
  end if;
  delete from public.conversation_members
  where conversation_id = conv and user_id = auth.uid();
end;
$$;

-- Mark a chat as read (clears the unread badge, and turns ticks blue in 1-on-1 chats).
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
    and exists (select 1 from public.conversations c where c.id = conv and not c.is_group);
end;
$$;

-- The chat list, now with groups, media previews and unread counts.
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
    lm.created_at,
    lm.sender_id,
    lm.sender_name,
    (select count(*) from public.messages m
       where m.conversation_id = c.id
         and m.sender_id <> auth.uid()
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
    select m2.body, m2.kind, m2.created_at, m2.sender_id, sp.name as sender_name
    from public.messages m2
    left join public.profiles sp on sp.id = m2.sender_id
    where m2.conversation_id = c.id
    order by m2.created_at desc
    limit 1
  ) lm on true
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- ---------- 5. LIVE UPDATES ----------
-- So people see a new group appear without refreshing.
do $$
begin
  alter publication supabase_realtime add table public.conversation_members;
exception when duplicate_object then null;
end $$;
