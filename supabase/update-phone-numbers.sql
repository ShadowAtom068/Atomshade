-- ATOMSHADE: phone numbers on profiles (so friends can find each other by number).
-- Run once in Supabase -> SQL Editor. Safe to run more than once.

alter table public.profiles add column if not exists phone text;

alter table public.profiles drop constraint if exists profiles_phone_format;
alter table public.profiles
  add constraint profiles_phone_format
  check (phone is null or phone ~ '^[0-9]{7,15}$');

create index if not exists profiles_phone_idx on public.profiles (phone);
