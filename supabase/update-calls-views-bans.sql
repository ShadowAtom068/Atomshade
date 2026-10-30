-- =====================================================================
-- Atomshade: status viewers, reports review for the owner, and account bans
-- Safe to run more than once. Run it in Supabase -> SQL Editor.
-- (Calls shown inside chats need no database change.)
-- =====================================================================

-- ---------- 1. WHO VIEWED MY STATUS ----------
create table if not exists public.status_views (
  status_id  uuid not null references public.statuses(id) on delete cascade,
  viewer_id  uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  viewed_at  timestamptz not null default now(),
  primary key (status_id, viewer_id)
);
create index if not exists status_views_status_idx on public.status_views (status_id, viewed_at desc);

alter table public.status_views enable row level security;

-- You can only record that YOU looked at someone else's status that you are allowed to see
-- (the subquery below follows the normal status visibility rules, including Inner Orbit).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='status_views' and policyname='record my own view') then
    create policy "record my own view" on public.status_views
      for insert to authenticated
      with check (
        viewer_id = auth.uid()
        and exists (select 1 from public.statuses s where s.id = status_id and s.user_id <> auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='status_views' and policyname='owner sees viewers') then
    create policy "owner sees viewers" on public.status_views
      for select to authenticated
      using (exists (select 1 from public.statuses s where s.id = status_id and s.user_id = auth.uid()));
  end if;
end $$;

-- (Second policy above: only the person who posted the status can see who viewed it.)

revoke all on public.status_views from anon;
revoke update, truncate, references, trigger on public.status_views from authenticated;
grant select, insert on public.status_views to authenticated;

-- ---------- 2. ADMINS AND BANS ----------
create table if not exists public.admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now()
);
create table if not exists public.banned_users (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  reason    text check (reason is null or char_length(reason) <= 300),
  banned_at timestamptz not null default now(),
  banned_by uuid references public.profiles(id) on delete set null,
  lifted_at timestamptz                  -- set when an admin lifts the ban
);
alter table public.banned_users add column if not exists lifted_at timestamptz;
alter table public.admins enable row level security;
alter table public.banned_users enable row level security;
revoke all on public.admins from anon, authenticated;        -- no policy, no grant: invisible to the app
revoke all on public.banned_users from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()); $$;

create or replace function public.is_banned(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.banned_users where user_id = p_user and lifted_at is null); $$;

-- The app asks this when it opens: am I banned, and why?
create or replace function public.my_ban()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when b.user_id is null or b.lifted_at is not null then null
         else jsonb_build_object('banned', true, 'reason', coalesce(b.reason, ''), 'since', b.banned_at) end
  from (select 1) x left join public.banned_users b on b.user_id = auth.uid();
$$;

-- A banned account can no longer send anything, even if it is still logged in.
create or replace function public.block_banned()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and exists (select 1 from public.banned_users where user_id = auth.uid() and lifted_at is null) then
    raise exception 'Your account has been suspended.';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['messages', 'statuses', 'calls', 'group_calls', 'shade_messages', 'shade_threads',
                           'channel_posts', 'reports', 'status_views', 'message_reactions', 'poll_votes']
  loop
    if to_regclass('public.' || t) is not null then
      if not exists (select 1 from pg_trigger where tgname = 'trg_block_banned' and tgrelid = to_regclass('public.' || t)) then
        execute format('create trigger trg_block_banned before insert on public.%I for each row execute function public.block_banned()', t);
      end if;
    end if;
  end loop;
end $$;

-- ---------- 3. ADMIN TOOLS (only people listed in public.admins can use these) ----------
create or replace function public.admin_open_count()
returns integer
language sql stable security definer set search_path = public
as $$
  select case when public.is_admin()
         then (select count(*)::int from public.reports where status = 'open') else 0 end;
$$;

create or replace function public.admin_reports(p_status text default 'open')
returns table (
  id uuid, created_at timestamptz, kind text, reason text, evidence text, evidence_verified boolean, status text,
  reporter_id uuid, reporter_name text, reporter_email text,
  reported_id uuid, reported_name text, reported_email text,
  reported_banned boolean, reports_against int
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
    select r.id, r.created_at, r.kind, r.reason, r.evidence, r.evidence_verified, r.status,
           r.reporter_id, rp.name, rp.email,
           r.reported_id, tp.name, tp.email,
           exists (select 1 from public.banned_users b where b.user_id = r.reported_id and b.lifted_at is null),
           (select count(*)::int from public.reports x where x.reported_id = r.reported_id)
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles tp on tp.id = r.reported_id
    where (p_status = 'all' or r.status = p_status)
    order by r.created_at desc
    limit 200;
end;
$$;

create or replace function public.admin_set_report(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('open', 'reviewed', 'actioned', 'dismissed') then raise exception 'Unknown status'; end if;
  update public.reports set status = p_status where id = p_id;
end;
$$;

create or replace function public.admin_ban(p_user uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_user is null or p_user = auth.uid() then raise exception 'You cannot ban yourself'; end if;
  if exists (select 1 from public.admins where user_id = p_user) then raise exception 'You cannot ban another admin'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Person not found'; end if;

  insert into public.banned_users (user_id, reason, banned_by, banned_at, lifted_at)
  values (p_user, left(coalesce(p_reason, ''), 300), auth.uid(), now(), null)
  on conflict (user_id) do update
    set reason = excluded.reason, banned_at = now(), banned_by = excluded.banned_by, lifted_at = null;

  update public.reports set status = 'actioned' where reported_id = p_user and status in ('open', 'reviewed');

  -- Stop new logins and token refreshes (best effort). The app also checks on every open,
  -- and the database refuses everything a banned account tries to send.
  begin
    update auth.users set banned_until = 'infinity' where id = p_user;
  exception when others then null;
  end;
end;
$$;

create or replace function public.admin_unban(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.banned_users set lifted_at = now() where user_id = p_user and lifted_at is null;
  begin
    update auth.users set banned_until = null where id = p_user;
  exception when others then null;
  end;
end;
$$;

create or replace function public.admin_banned_list()
returns table (user_id uuid, name text, email text, reason text, banned_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
    select b.user_id, p.name, p.email, b.reason, b.banned_at
    from public.banned_users b left join public.profiles p on p.id = b.user_id
    where b.lifted_at is null
    order by b.banned_at desc;
end;
$$;

-- Lock the functions down: only logged-in users can call them (and the admin ones check inside).
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_banned(uuid) from public, anon, authenticated;
revoke all on function public.my_ban() from public, anon;
revoke all on function public.admin_open_count() from public, anon;
revoke all on function public.admin_reports(text) from public, anon;
revoke all on function public.admin_set_report(uuid, text) from public, anon;
revoke all on function public.admin_ban(uuid, text) from public, anon;
revoke all on function public.admin_unban(uuid) from public, anon;
revoke all on function public.admin_banned_list() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.my_ban() to authenticated;
grant execute on function public.admin_open_count() to authenticated;
grant execute on function public.admin_reports(text) to authenticated;
grant execute on function public.admin_set_report(uuid, text) to authenticated;
grant execute on function public.admin_ban(uuid, text) to authenticated;
grant execute on function public.admin_unban(uuid) to authenticated;
grant execute on function public.admin_banned_list() to authenticated;

-- ---------- 4. THE OWNER IS THE FIRST ADMIN ----------
insert into public.admins (user_id)
select id from public.profiles where lower(email) = 'emmanuelatomic068@gmail.com'
on conflict do nothing;
