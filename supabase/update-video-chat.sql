-- =====================================================================
-- ATOMSHADE VIDEOS IN CHATS (run once, in Supabase -> SQL Editor). Safe to run again.
-- Lets normal chats (not secret chats) carry videos up to 50 MB.
-- =====================================================================

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'image', 'audio', 'video'));

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  (deleted_for_everyone = true and body is null and media_path is null)
  or (kind = 'text' and body is not null
      and char_length(body) between 1 and (case when e2ee then 12000 else 4000 end))
  or (kind in ('image', 'audio', 'video') and media_path is not null and not e2ee)
);

-- Chat storage: add video types and allow bigger files (50 MB).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
    set allowed_mime_types = array[
          'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif',
          'audio/*',
          'video/mp4', 'video/webm', 'video/quicktime'
        ],
        file_size_limit = 52428800,
        public = false
    where id = 'chat-media';
  end if;
end $$;
