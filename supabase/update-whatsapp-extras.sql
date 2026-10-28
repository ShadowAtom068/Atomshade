-- Atomshade "WhatsApp extras": documents, location, polls, view-once, reactions, edit message,
-- mute and pin chats. Safe to run more than once. Run AFTER update-settings.sql.
-- (Safe to paste in the SQL Editor.)

-- ---------- 1. EXTRA FIELDS ON MESSAGES ----------
alter table public.messages add column if not exists meta jsonb;
alter table public.messages add column if not exists view_once boolean not null default false;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists forwarded boolean not null default false;
grant insert (meta, view_once, forwarded) on public.messages to authenticated;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_meta_size_check') then
    alter table public.messages add constraint messages_meta_size_check
      check (meta is null or pg_column_size(meta) <= 3000);
  end if;
end $$;

-- Documents, locations and polls travel as ordinary text messages with a small "meta" label,
-- so older versions of the app still show a readable line (for example "📄 report.pdf").
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
  else
    raise exception 'Unknown message type';
  end if;
  return new;
end;
$$;
revoke execute on function public.messages_meta_guard() from public, anon, authenticated;
create or replace trigger trg_messages_meta_guard before insert on public.messages
  for each row execute function public.messages_meta_guard();

-- Chat storage: also allow common document types.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
    set allowed_mime_types = array[
          'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif',
          'audio/*',
          'video/mp4', 'video/webm', 'video/quicktime',
          'application/pdf', 'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed',
          'application/rtf', 'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet'
        ],
        file_size_limit = 52428800,
        public = false
    where id = 'chat-media';
  end if;
end $$;

-- ---------- 2. EDIT A MESSAGE (text only, your own, within 15 minutes of sending) ----------
create or replace function public.edit_message(p_message uuid, p_body text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m public.messages;
  b text := p_body;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into m from public.messages where id = p_message;
  if not found or m.sender_id <> auth.uid() or not public.is_member(m.conversation_id) then
    raise exception 'You can only edit your own messages';
  end if;
  if m.deleted_for_everyone then raise exception 'That message was removed'; end if;
  if m.kind <> 'text' or m.meta is not null or m.media_path is not null then
    raise exception 'Only text messages can be edited';
  end if;
  if m.deliver_at is null and now() - m.created_at > interval '15 minutes' then
    raise exception 'You can edit a message for 15 minutes after sending it';
  end if;
  if m.deliver_at is not null and m.deliver_at <= now() and now() - m.deliver_at > interval '15 minutes' then
    raise exception 'You can edit a message for 15 minutes after it opens';
  end if;
  if not m.e2ee then b := trim(coalesce(b, '')); end if;
  if b is null or char_length(b) < 1 or char_length(b) > (case when m.e2ee then 12000 else 4000 end) then
    raise exception 'The message cannot be empty or too long';
  end if;
  update public.messages set body = b, edited_at = now() where id = p_message;
end;
$$;

-- ---------- 3. REACTIONS (one emoji per person per message; set to nothing to remove) ----------
create table if not exists public.message_reactions (
  message_id      uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  emoji           text,
  updated_at      timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_reactions_conv_idx on public.message_reactions (conversation_id);
alter table public.message_reactions enable row level security;
revoke all on public.message_reactions from public, anon, authenticated;
grant select on public.message_reactions to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'message_reactions' and policyname = 'members see reactions') then
    create policy "members see reactions" on public.message_reactions for select to authenticated
      using (public.is_member(conversation_id));
  end if;
end $$;

create or replace function public.react_message(p_message uuid, p_emoji text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  conv uuid;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if p_emoji is not null and not (p_emoji = any (array['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏'])) then
    raise exception 'That reaction is not available';
  end if;
  select m.conversation_id into conv from public.messages m
   where m.id = p_message and not m.deleted_for_everyone
     and (m.deliver_at is null or m.deliver_at <= now() or m.sender_id = auth.uid())
     and (m.expires_at is null or m.expires_at > now());
  if conv is null or not public.is_member(conv) then raise exception 'Message not found'; end if;
  insert into public.message_reactions (message_id, conversation_id, user_id, emoji)
  values (p_message, conv, auth.uid(), p_emoji)
  on conflict (message_id, user_id) do update set emoji = excluded.emoji, updated_at = now();
end;
$$;

-- ---------- 4. POLLS ----------
create table if not exists public.poll_votes (
  message_id      uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  choices         integer[] not null default '{}',
  updated_at      timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists poll_votes_conv_idx on public.poll_votes (conversation_id);
alter table public.poll_votes enable row level security;
revoke all on public.poll_votes from public, anon, authenticated;
grant select on public.poll_votes to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'poll_votes' and policyname = 'members see votes') then
    create policy "members see votes" on public.poll_votes for select to authenticated
      using (public.is_member(conversation_id));
  end if;
end $$;

-- Send your choices (an empty list removes your vote). Single-choice polls take one option.
create or replace function public.vote_poll(p_message uuid, p_choices integer[])
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m public.messages;
  n integer;
  c integer[];
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into m from public.messages where id = p_message and not deleted_for_everyone
     and (expires_at is null or expires_at > now());
  if not found or m.meta is null or m.meta ->> 't' <> 'poll' or not public.is_member(m.conversation_id) then
    raise exception 'Poll not found';
  end if;
  if m.deliver_at is not null and m.deliver_at > now() then raise exception 'Poll not found'; end if;
  n := jsonb_array_length(m.meta -> 'options');
  select coalesce(array_agg(distinct x order by x), '{}') into c from unnest(coalesce(p_choices, '{}')) x;
  if exists (select 1 from unnest(c) x where x < 0 or x >= n) then raise exception 'That option does not exist'; end if;
  if not coalesce((m.meta ->> 'multi')::boolean, false) and coalesce(array_length(c, 1), 0) > 1 then
    raise exception 'Pick only one option';
  end if;
  insert into public.poll_votes (message_id, conversation_id, user_id, choices)
  values (p_message, m.conversation_id, auth.uid(), c)
  on conflict (message_id, user_id) do update set choices = excluded.choices, updated_at = now();
end;
$$;

-- ---------- 5. VIEW ONCE (photos and videos) ----------
create table if not exists public.view_once_views (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.view_once_views enable row level security;
revoke all on public.view_once_views from public, anon, authenticated;
grant select on public.view_once_views to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'view_once_views' and policyname = 'see my views and opens of mine') then
    create policy "see my views and opens of mine" on public.view_once_views for select to authenticated
      using (user_id = auth.uid()
             or exists (select 1 from public.messages m where m.id = message_id and m.sender_id = auth.uid()));
  end if;
end $$;

create or replace function public.view_once_seen(p_message uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  m public.messages;
  got integer;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into m from public.messages where id = p_message and view_once and not deleted_for_everyone;
  if not found or m.sender_id = auth.uid() or not public.is_member(m.conversation_id) then
    return false;
  end if;
  insert into public.view_once_views (message_id, user_id) values (p_message, auth.uid())
  on conflict do nothing;
  get diagnostics got = row_count;
  return got = 1; -- true only the first time
end;
$$;

-- ---------- 6. MUTE AND PIN CHATS ----------
alter table public.chat_prefs add column if not exists pinned boolean not null default false;
alter table public.chat_prefs add column if not exists muted_until timestamptz;

create or replace function public.set_chat_pref(p_conv uuid, p_field text, p_text text default null, p_bool boolean default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  nick text := nullif(trim(coalesce(p_text, '')), '');
begin
  if uid is null then raise exception 'Please log in first'; end if;
  if not public.is_member(p_conv) then raise exception 'Chat not found'; end if;
  if p_field not in ('nickname', 'archived', 'locked', 'pinned') then raise exception 'Unknown option'; end if;
  if p_field = 'nickname' and nick is not null and char_length(nick) > 40 then
    raise exception 'That name is too long (40 characters at most)';
  end if;
  if p_field in ('archived', 'locked', 'pinned') and p_bool is null then raise exception 'Missing value'; end if;
  if p_field = 'pinned' and p_bool and (
       select count(*) from public.chat_prefs where user_id = uid and pinned and conversation_id <> p_conv) >= 3 then
    raise exception 'You can pin up to 3 chats';
  end if;

  insert into public.chat_prefs (user_id, conversation_id) values (uid, p_conv)
  on conflict do nothing;

  if p_field = 'nickname' then
    update public.chat_prefs set nickname = nick, updated_at = now() where user_id = uid and conversation_id = p_conv;
  elsif p_field = 'archived' then
    update public.chat_prefs set archived = p_bool, updated_at = now() where user_id = uid and conversation_id = p_conv;
  elsif p_field = 'pinned' then
    update public.chat_prefs set pinned = p_bool, updated_at = now() where user_id = uid and conversation_id = p_conv;
  else
    update public.chat_prefs set locked = p_bool, updated_at = now() where user_id = uid and conversation_id = p_conv;
  end if;
end;
$$;

-- p_hours: 0 = unmute, -1 = mute for ever, otherwise that many hours.
create or replace function public.set_chat_mute(p_conv uuid, p_hours integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  until timestamptz;
begin
  if uid is null then raise exception 'Please log in first'; end if;
  if not public.is_member(p_conv) then raise exception 'Chat not found'; end if;
  if p_hours is null or p_hours < -1 or p_hours > 24 * 365 then raise exception 'Choose a mute time'; end if;
  until := case when p_hours = 0 then null when p_hours = -1 then timestamptz '2100-01-01' else now() + (p_hours * interval '1 hour') end;
  insert into public.chat_prefs (user_id, conversation_id) values (uid, p_conv) on conflict do nothing;
  update public.chat_prefs set muted_until = until, updated_at = now() where user_id = uid and conversation_id = p_conv;
end;
$$;

create or replace function public.my_chat_flags()
returns table (conversation_id uuid, pinned boolean, muted boolean, muted_until timestamptz)
language sql stable security definer set search_path = public
as $$
  select cp.conversation_id, cp.pinned, coalesce(cp.muted_until > now(), false), cp.muted_until
  from public.chat_prefs cp
  where cp.user_id = auth.uid();
$$;

-- ---------- 7. LIVE UPDATES ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'message_reactions') then
      alter publication supabase_realtime add table public.message_reactions;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'poll_votes') then
      alter publication supabase_realtime add table public.poll_votes;
    end if;
  end if;
end $$;

-- ---------- 8. WHO CAN CALL WHAT ----------
grant execute on function public.edit_message(uuid, text), public.react_message(uuid, text),
  public.vote_poll(uuid, integer[]), public.view_once_seen(uuid), public.set_chat_pref(uuid, text, text, boolean),
  public.set_chat_mute(uuid, integer), public.my_chat_flags() to authenticated;
revoke execute on function public.edit_message(uuid, text), public.react_message(uuid, text),
  public.vote_poll(uuid, integer[]), public.view_once_seen(uuid), public.set_chat_pref(uuid, text, text, boolean),
  public.set_chat_mute(uuid, integer), public.my_chat_flags() from public, anon;
