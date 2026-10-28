-- =====================================================================
-- ATOMSHADE UPDATE v0.5: replies, delete for everyone, 24-hour statuses
-- Run after schema.sql and update-v0.4.sql in Supabase SQL Editor.
-- Safe to re-run.
-- =====================================================================

-- Replies and message deletion metadata.
alter table public.messages
  add column if not exists reply_to uuid references public.messages(id) on delete set null,
  add column if not exists deleted_for_everyone boolean not null default false,
  add column if not exists deleted_at timestamptz;

create index if not exists messages_reply_to_idx on public.messages(reply_to);

-- Permit the soft-deleted placeholder row while preserving v0.4 content validation.
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  (deleted_for_everyone = true and body is null and media_path is null)
  or (kind = 'text' and body is not null and char_length(body) between 1 and 4000)
  or (kind in ('image', 'audio') and media_path is not null)
);

-- Status posts expire 24 hours after creation. Supports text, images, and videos.
create table if not exists public.statuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text,
  kind text not null default 'text' check (kind in ('text', 'image', 'video')),
  media_path text,
  background text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
-- Upgrade an earlier text-only v0.5 status table safely.
alter table public.statuses add column if not exists kind text not null default 'text';
alter table public.statuses add column if not exists media_path text;
alter table public.statuses add column if not exists background text;
alter table public.statuses alter column body drop not null;
alter table public.statuses drop constraint if exists statuses_kind_check;
alter table public.statuses add constraint statuses_kind_check check (kind in ('text', 'image', 'video'));
alter table public.statuses drop constraint if exists statuses_content_check;
alter table public.statuses add constraint statuses_content_check check (
  (kind = 'text' and body is not null and char_length(trim(body)) between 1 and 700 and media_path is null)
  or (kind in ('image', 'video') and media_path is not null and (body is null or char_length(body) <= 300))
);

-- Private storage for status media. Users upload only to their own folder;
-- signed URLs are issued only for media belonging to an unexpired status.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('status-media', 'status-media', false, 52428800, array['image/*', 'video/*'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, public = false;

drop policy if exists "upload own status media" on storage.objects;
drop policy if exists "read active status media" on storage.objects;
drop policy if exists "delete own status media" on storage.objects;
create policy "upload own status media" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'status-media' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "read active status media" on storage.objects
  for select to authenticated using (
    bucket_id = 'status-media' and exists (
      select 1 from public.statuses s
      where s.media_path = storage.objects.name and s.expires_at > now()
    )
  );
create policy "delete own status media" on storage.objects
  for delete to authenticated using (
    bucket_id = 'status-media' and (storage.foldername(name))[1] = auth.uid()::text
  );

create index if not exists statuses_user_created_idx on public.statuses(user_id, created_at desc);
create index if not exists statuses_expiry_idx on public.statuses(expires_at);
alter table public.statuses enable row level security;
grant select, insert, delete on public.statuses to authenticated;

drop policy if exists "read unexpired statuses" on public.statuses;
drop policy if exists "create own status" on public.statuses;
drop policy if exists "delete own status" on public.statuses;
create policy "read unexpired statuses" on public.statuses
  for select to authenticated using (expires_at > now());
create policy "create own status" on public.statuses
  for insert to authenticated with check (user_id = auth.uid() and expires_at > now());
create policy "delete own status" on public.statuses
  for delete to authenticated using (user_id = auth.uid());

-- Only the original sender can remove their message for everyone.
-- Soft deletion preserves reply references and replaces the content for all members.
create or replace function public.delete_message_for_everyone(message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.messages%rowtype;
begin
  select * into target from public.messages where id = message_id;
  if not found then raise exception 'Message not found'; end if;
  if target.sender_id <> auth.uid() then raise exception 'You can only delete your own messages'; end if;
  if not public.is_member(target.conversation_id) then raise exception 'You are not a member of this chat'; end if;
  if target.created_at < now() - interval '1 hour' then raise exception 'Messages can only be deleted for everyone within one hour'; end if;
  update public.messages
    set body = null, media_path = null, duration_ms = null,
        deleted_for_everyone = true, deleted_at = now(), kind = 'text'
    where id = message_id;
end;
$$;

-- RPC access is limited to signed-in users; the function enforces sender/member checks.
revoke all on function public.delete_message_for_everyone(uuid) from public;
grant execute on function public.delete_message_for_everyone(uuid) to authenticated;

-- Enable live updates for status posts where the publication exists.
do $$
begin
  alter publication supabase_realtime add table public.statuses;
exception when duplicate_object then null;
when undefined_object then null;
end $$;

-- Clean-up helper; expired statuses are already hidden by RLS, this removes old rows.
create or replace function public.cleanup_expired_statuses()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed integer;
begin
  delete from public.statuses where expires_at <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.cleanup_expired_statuses() from public;
