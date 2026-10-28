-- =====================================================================
-- ATOMSHADE UPDATE v0.6: channels and communities
-- Run AFTER update-v0.5.sql. Safe to re-run.
-- =====================================================================

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  creator_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  role text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table if not exists public.channel_posts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text not null check (char_length(trim(body)) between 1 and 3000),
  created_at timestamptz not null default now()
);

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  creator_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  role text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index if not exists channels_created_idx on public.channels(created_at desc);
create index if not exists channel_posts_feed_idx on public.channel_posts(channel_id, created_at desc);
create index if not exists communities_created_idx on public.communities(created_at desc);
create index if not exists channel_members_user_idx on public.channel_members(user_id);
create index if not exists community_members_user_idx on public.community_members(user_id);

alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.channel_posts enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;

grant select, insert on public.channels to authenticated;
grant select, insert, delete on public.channel_members to authenticated;
grant select, insert on public.channel_posts to authenticated;
grant select, insert on public.communities to authenticated;
grant select, insert, delete on public.community_members to authenticated;

drop policy if exists "channels visible to signed in users" on public.channels;
create policy "channels visible to signed in users" on public.channels
  for select to authenticated using (true);
drop policy if exists "create channel as self" on public.channels;
create policy "create channel as self" on public.channels
  for insert to authenticated with check (creator_id = auth.uid());

drop policy if exists "read channel memberships" on public.channel_members;
create policy "read channel memberships" on public.channel_members
  for select to authenticated using (true);
drop policy if exists "join channel as self" on public.channel_members;
create policy "join channel as self" on public.channel_members
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "leave channel as self" on public.channel_members;
create policy "leave channel as self" on public.channel_members
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "read posts in followed channels" on public.channel_posts;
create policy "read posts in followed channels" on public.channel_posts
  for select to authenticated using (exists (
    select 1 from public.channel_members cm
    where cm.channel_id = channel_posts.channel_id and cm.user_id = auth.uid()
  ));
drop policy if exists "publish in followed channels" on public.channel_posts;
create policy "publish in followed channels" on public.channel_posts
  for insert to authenticated with check (
    author_id = auth.uid() and exists (
      select 1 from public.channel_members cm
      where cm.channel_id = channel_posts.channel_id and cm.user_id = auth.uid()
    )
  );

drop policy if exists "communities visible to signed in users" on public.communities;
create policy "communities visible to signed in users" on public.communities
  for select to authenticated using (true);
drop policy if exists "create community as self" on public.communities;
create policy "create community as self" on public.communities
  for insert to authenticated with check (creator_id = auth.uid());

drop policy if exists "read community memberships" on public.community_members;
create policy "read community memberships" on public.community_members
  for select to authenticated using (true);
drop policy if exists "join community as self" on public.community_members;
create policy "join community as self" on public.community_members
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "leave community as self" on public.community_members;
create policy "leave community as self" on public.community_members
  for delete to authenticated using (user_id = auth.uid());

do $$ begin
  alter publication supabase_realtime add table public.channels;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.channel_posts;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.communities;
exception when duplicate_object then null; when undefined_object then null; end $$;
