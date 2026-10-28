-- =====================================================================
-- ATOMSHADE PUSH NOTIFICATIONS (run once, in Supabase -> SQL Editor). Safe to run again.
-- Stores each device's notification address and tells the "push" function
-- when a message, a time capsule or a call needs to reach someone.
-- =====================================================================

do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net not available: %', sqlerrm; end $$;
do $$ begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron not available: %', sqlerrm; end $$;

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique check (char_length(endpoint) <= 1200 and endpoint like 'https://%'),
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- Where to send, the shared secret that proves a request really came from this database,
-- and the notification signing keys. Nobody but the server can read this table.
create table if not exists public.push_config (
  id     integer primary key default 1 check (id = 1),
  url    text not null,
  secret text not null,
  vapid_public  text not null,
  vapid_private text not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Please log in first'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = uid, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  -- keep at most 10 devices per person
  delete from public.push_subscriptions
  where user_id = uid and id not in (
    select id from public.push_subscriptions where user_id = uid order by created_at desc limit 10
  );
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

-- Messages: remember whether the push for it has already gone out.
alter table public.messages add column if not exists push_done boolean not null default false;

create or replace function public.push_flag_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.push_done := (new.deliver_at is null);   -- time capsules are announced when they open
  return new;
end;
$$;
drop trigger if exists messages_push_flag on public.messages;
create trigger messages_push_flag before insert on public.messages
  for each row execute function public.push_flag_message();

-- Ask the push function to deliver one notification. It must never break sending a message.
create or replace function public.push_send(p_type text, p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare cfg public.push_config;
begin
  select * into cfg from public.push_config where id = 1;
  if cfg.url is null then return; end if;
  begin
    perform net.http_post(
      url     := cfg.url,
      headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', cfg.secret),
      body    := jsonb_build_object('type', p_type, 'id', p_id),
      timeout_milliseconds := 4000
    );
  exception when others then
    null;
  end;
end;
$$;

create or replace function public.push_on_message()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.deliver_at is null then
    perform public.push_send('message', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages
  for each row execute function public.push_on_message();

create or replace function public.push_on_call()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'ringing' then
    perform public.push_send('call', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists calls_push on public.calls;
create trigger calls_push after insert on public.calls
  for each row execute function public.push_on_call();

-- Time capsules: every minute, announce the ones that just opened.
create or replace function public.push_due_capsules()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare r record; n integer := 0;
begin
  for r in
    update public.messages set push_done = true
    where not push_done and deliver_at is not null and deliver_at <= now() and not deleted_for_everyone
    returning id
  loop
    perform public.push_send('message', r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'atomshade-push-capsules';
    perform cron.schedule('atomshade-push-capsules', '* * * * *', 'select public.push_due_capsules()');
  end if;
exception when others then
  raise notice 'could not schedule capsule pushes: %', sqlerrm;
end $$;

-- Only the app (logged-in users) may save or remove their own device. Nobody else may run the helpers.
revoke execute on function public.save_push_subscription(text, text, text), public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text), public.remove_push_subscription(text) to authenticated;
revoke execute on function public.push_send(text, uuid), public.push_on_message(), public.push_on_call(), public.push_flag_message(), public.push_due_capsules() from public, anon, authenticated;
