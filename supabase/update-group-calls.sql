-- Atomshade: stickers and group calls. Safe to run more than once. Run AFTER update-whatsapp-extras.sql.

-- ---------- 1. STICKERS (a sticker is a small text message with a label) ----------
create or replace function public.messages_meta_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  t text;
  i integer;
  opts jsonb;
  mimes text[] := array[
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed',
    'application/rtf', 'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet'
  ];
begin
  if new.view_once and (new.kind not in ('image', 'video') or new.e2ee or new.deliver_at is not null) then
    raise exception 'Only photos and videos can be sent as view once';
  end if;
  if new.meta is null then
    return new;
  end if;
  if new.e2ee or new.kind <> 'text' or jsonb_typeof(new.meta) <> 'object' then
    raise exception 'This message cannot carry extra data';
  end if;
  t := new.meta ->> 't';
  if t = 'location' then
    if jsonb_typeof(new.meta -> 'lat') <> 'number' or jsonb_typeof(new.meta -> 'lng') <> 'number'
       or (new.meta ->> 'lat')::numeric not between -90 and 90
       or (new.meta ->> 'lng')::numeric not between -180 and 180 then
      raise exception 'That location is not valid';
    end if;
    if new.media_path is not null then raise exception 'A location cannot have a file'; end if;
  elsif t = 'file' then
    if new.media_path is null then raise exception 'A document needs a file'; end if;
    if jsonb_typeof(new.meta -> 'name') <> 'string' or char_length(new.meta ->> 'name') not between 1 and 150 then
      raise exception 'That file name is not valid';
    end if;
    if jsonb_typeof(new.meta -> 'size') <> 'number' or (new.meta ->> 'size')::numeric not between 0 and 52428800 then
      raise exception 'Documents can be up to 50 MB';
    end if;
    if jsonb_typeof(new.meta -> 'mime') <> 'string' or not ((new.meta ->> 'mime') = any (mimes)) then
      raise exception 'That kind of file cannot be sent';
    end if;
  elsif t = 'poll' then
    if new.media_path is not null then raise exception 'A poll cannot have a file'; end if;
    if jsonb_typeof(new.meta -> 'q') <> 'string' or char_length(new.meta ->> 'q') not between 1 and 200 then
      raise exception 'A poll needs a question (up to 200 letters)';
    end if;
    opts := new.meta -> 'options';
    if jsonb_typeof(opts) <> 'array' or jsonb_array_length(opts) not between 2 and 6 then
      raise exception 'A poll needs 2 to 6 options';
    end if;
    for i in 0 .. jsonb_array_length(opts) - 1 loop
      if jsonb_typeof(opts -> i) <> 'string' or char_length(opts ->> i) not between 1 and 100 then
        raise exception 'Each poll option needs 1 to 100 letters';
      end if;
    end loop;
    if new.meta ? 'multi' and jsonb_typeof(new.meta -> 'multi') <> 'boolean' then
      raise exception 'Poll setting is not valid';
    end if;
  elsif t = 'sticker' then
    if new.media_path is not null then raise exception 'A sticker cannot have a file'; end if;
    if jsonb_typeof(new.meta -> 's') <> 'string' or char_length(new.meta ->> 's') not between 1 and 16 then
      raise exception 'That sticker is not valid';
    end if;
  else
    raise exception 'Unknown message type';
  end if;
  return new;
end;
$$;

-- ---------- 2. GROUP CALLS (up to 4 people in one call) ----------
create table if not exists public.group_calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  started_by      uuid references public.profiles(id) on delete set null,
  media           text not null check (media in ('audio', 'video')),
  status          text not null default 'active' check (status in ('active', 'ended')),
  created_at      timestamptz not null default now(),
  ended_at        timestamptz
);
create index if not exists group_calls_conv_idx on public.group_calls (conversation_id, created_at desc);

create table if not exists public.group_call_participants (
  call_id   uuid not null references public.group_calls(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  left_at   timestamptz,
  primary key (call_id, user_id)
);

alter table public.group_calls enable row level security;
alter table public.group_call_participants enable row level security;
revoke all on public.group_calls, public.group_call_participants from public, anon, authenticated;
grant select on public.group_calls, public.group_call_participants to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'group_calls' and policyname = 'members see group calls') then
    create policy "members see group calls" on public.group_calls for select to authenticated
      using (public.is_member(conversation_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'group_call_participants' and policyname = 'members see call participants') then
    create policy "members see call participants" on public.group_call_participants for select to authenticated
      using (exists (select 1 from public.group_calls c where c.id = call_id and public.is_member(c.conversation_id)));
  end if;
end $$;

-- Someone counts as "in the call" while they have pinged in the last 45 seconds and have not left.
create or replace function public.gcall_in_count(p_call uuid, p_except uuid default null)
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::integer from public.group_call_participants p
  where p.call_id = p_call and p.left_at is null and p.last_seen > now() - interval '45 seconds'
    and (p_except is null or p.user_id <> p_except);
$$;

create or replace function public.start_group_call(p_conv uuid, p_media text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  grp boolean;
  sec boolean;
  cid uuid;
begin
  if uid is null then raise exception 'Please log in first'; end if;
  if p_media not in ('audio', 'video') then raise exception 'Choose voice or video'; end if;
  select c.is_group, c.secret into grp, sec from public.conversations c where c.id = p_conv;
  if grp is null or not public.is_member(p_conv) then raise exception 'You are not in this group'; end if;
  if not grp or sec then raise exception 'Group calls are only for groups'; end if;
  -- A call is already going on: join it instead of starting a second one.
  select c.id into cid from public.group_calls c
   where c.conversation_id = p_conv and c.status = 'active' and public.gcall_in_count(c.id) > 0
   order by c.created_at desc limit 1;
  if cid is not null then return cid; end if;
  update public.group_calls set status = 'ended', ended_at = now() where conversation_id = p_conv and status = 'active';
  insert into public.group_calls (conversation_id, started_by, media) values (p_conv, uid, p_media) returning id into cid;
  insert into public.group_call_participants (call_id, user_id) values (cid, uid);
  return cid;
end;
$$;

create or replace function public.join_group_call(p_call uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c public.group_calls;
begin
  if uid is null then raise exception 'Please log in first'; end if;
  select * into c from public.group_calls where id = p_call;
  if not found or not public.is_member(c.conversation_id) then raise exception 'Call not found'; end if;
  if c.status <> 'active' then raise exception 'This call has ended'; end if;
  if public.gcall_in_count(p_call, uid) >= 4 then raise exception 'This call is full (4 people at most)'; end if;
  insert into public.group_call_participants (call_id, user_id) values (p_call, uid)
  on conflict (call_id, user_id) do update set left_at = null, last_seen = now(), joined_at = now();
end;
$$;

-- Called every few seconds by people in the call. Returns false once the call is over.
create or replace function public.ping_group_call(p_call uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare ok boolean;
begin
  if auth.uid() is null then return false; end if;
  update public.group_call_participants set last_seen = now()
   where call_id = p_call and user_id = auth.uid() and left_at is null;
  select (c.status = 'active') into ok from public.group_calls c where c.id = p_call;
  return coalesce(ok, false);
end;
$$;

create or replace function public.leave_group_call(p_call uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  update public.group_call_participants set left_at = now() where call_id = p_call and user_id = auth.uid() and left_at is null;
  if public.gcall_in_count(p_call) = 0 then
    update public.group_calls set status = 'ended', ended_at = now() where id = p_call and status = 'active';
  end if;
end;
$$;

-- The call going on right now in a group (if any), and who is in it.
create or replace function public.active_group_call(p_conv uuid)
returns table (call_id uuid, media text, started_by uuid, started_at timestamptz, participants uuid[])
language sql stable security definer set search_path = public
as $$
  select c.id, c.media, c.started_by, c.created_at,
         array(select p.user_id from public.group_call_participants p
                where p.call_id = c.id and p.left_at is null and p.last_seen > now() - interval '45 seconds')
  from public.group_calls c
  where c.conversation_id = p_conv and c.status = 'active' and public.is_member(p_conv)
    and public.gcall_in_count(c.id) > 0
  order by c.created_at desc
  limit 1;
$$;

-- Ring everyone: tell the push function when a group call starts.
create or replace function public.push_on_group_call()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.push_send('gcall', new.id);
  return new;
end;
$$;
create or replace trigger group_calls_push after insert on public.group_calls
  for each row execute function public.push_on_group_call();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_calls') then
      alter publication supabase_realtime add table public.group_calls;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_call_participants') then
      alter publication supabase_realtime add table public.group_call_participants;
    end if;
  end if;
end $$;

revoke execute on function public.messages_meta_guard(), public.push_on_group_call(), public.gcall_in_count(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_group_call(uuid, text), public.join_group_call(uuid), public.ping_group_call(uuid),
  public.leave_group_call(uuid), public.active_group_call(uuid) to authenticated;
revoke execute on function public.start_group_call(uuid, text), public.join_group_call(uuid), public.ping_group_call(uuid),
  public.leave_group_call(uuid), public.active_group_call(uuid) from public, anon;
