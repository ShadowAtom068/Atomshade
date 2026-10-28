-- =====================================================================
-- ATOMSHADE DATABASE SETUP
-- Paste this whole file into Supabase -> SQL Editor -> New query -> Run
-- (Safe to run once on a fresh project.)
-- =====================================================================

-- ---------- TABLES ----------

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  name        text,
  about       text default 'Hey there! I am using Atomshade.',
  created_at  timestamptz default now()
);

create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now()
);

create table public.conversation_members (
  conversation_id uuid references public.conversations(id) on delete cascade,
  user_id         uuid references public.profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null default auth.uid() references public.profiles(id),
  body            text not null check (char_length(body) between 1 and 4000),
  created_at      timestamptz default now(),
  delivered_at    timestamptz,
  read_at         timestamptz
);

create index messages_conv_created_idx on public.messages (conversation_id, created_at);

-- ---------- AUTO-CREATE A PROFILE WHEN SOMEONE SIGNS UP ----------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, lower(new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- HELPER: IS THE LOGGED-IN USER IN THIS CONVERSATION? ----------

create function public.is_member(conv uuid)
returns boolean
language sql
security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = conv and user_id = auth.uid()
  );
$$;

-- ---------- SECURITY RULES (Row Level Security) ----------

alter table public.profiles             enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;

-- Profiles: any logged-in user can see profiles (so friends can find each other).
-- You can only edit your own.
create policy "profiles readable by logged-in users"
  on public.profiles for select to authenticated using (true);
create policy "edit own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Conversations and members: only visible to people inside them.
create policy "see my conversations"
  on public.conversations for select to authenticated using (public.is_member(id));
create policy "see members of my conversations"
  on public.conversation_members for select to authenticated using (public.is_member(conversation_id));

-- Messages: read only in your conversations; send only as yourself;
-- the OTHER person can update a message (to mark it delivered / read).
create policy "read messages in my conversations"
  on public.messages for select to authenticated using (public.is_member(conversation_id));
create policy "send messages as myself"
  on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(conversation_id));
create policy "mark received messages delivered or read"
  on public.messages for update to authenticated
  using (public.is_member(conversation_id) and sender_id <> auth.uid());

-- ---------- FUNCTIONS THE APP CALLS ----------

-- Start (or reopen) a 1-on-1 chat with another user. Returns the conversation id.
create function public.create_or_get_dm(other uuid)
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

-- The chat list: every conversation with the other person, last message and unread count.
create function public.my_chats()
returns table (
  conversation_id uuid,
  other_id        uuid,
  other_name      text,
  other_email     text,
  last_body       text,
  last_at         timestamptz,
  last_sender     uuid,
  unread_count    bigint
)
language sql
security definer stable
set search_path = public
as $$
  select
    c.id,
    p.id,
    p.name,
    p.email,
    lm.body,
    lm.created_at,
    lm.sender_id,
    (select count(*) from public.messages m
       where m.conversation_id = c.id
         and m.sender_id <> auth.uid()
         and m.read_at is null)
  from public.conversations c
  join public.conversation_members me
    on me.conversation_id = c.id and me.user_id = auth.uid()
  join public.conversation_members other_m
    on other_m.conversation_id = c.id and other_m.user_id <> auth.uid()
  join public.profiles p on p.id = other_m.user_id
  left join lateral (
    select m2.body, m2.created_at, m2.sender_id
    from public.messages m2
    where m2.conversation_id = c.id
    order by m2.created_at desc
    limit 1
  ) lm on true
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- ---------- LIVE UPDATES ----------
alter publication supabase_realtime add table public.messages;
