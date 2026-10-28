-- =====================================================================
-- ATOMSHADE STATUS MUSIC (run once, in Supabase -> SQL Editor). Safe to run again.
-- Lets a photo or video status carry a song picked from the poster's own device.
-- =====================================================================

alter table public.statuses add column if not exists audio_path  text;
alter table public.statuses add column if not exists audio_start integer not null default 0;
alter table public.statuses add column if not exists audio_title text;

alter table public.statuses drop constraint if exists statuses_audio_check;
alter table public.statuses add constraint statuses_audio_check check (
  audio_path is null
  or (kind in ('image', 'video')
      and audio_path like user_id::text || '/%'
      and audio_start between 0 and 7200
      and (audio_title is null or char_length(audio_title) <= 80))
);

grant insert (audio_path, audio_start, audio_title) on public.statuses to authenticated;

-- Storage: songs live in the same private status-media bucket, in the poster's own folder.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
    set allowed_mime_types = array[
          'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif',
          'video/mp4', 'video/webm', 'video/quicktime',
          'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav'
        ]
    where id = 'status-media';
  end if;
  if to_regclass('storage.objects') is not null
     and exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'read active status media') then
    -- Whoever may see the status (including Inner Orbit rules) may hear its song.
    alter policy "read active status media" on storage.objects
      using (
        bucket_id = 'status-media' and exists (
          select 1 from public.statuses s
          where (s.media_path = storage.objects.name or s.audio_path = storage.objects.name)
            and s.expires_at > now()
        )
      );
  end if;
end $$;
