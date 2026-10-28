-- Atomshade Settings, part 2: the parts that remove data (un-star, delete my account, disappearing clean-up).
-- Run AFTER update-settings.sql. Safe to run more than once.

-- Un-star: you can remove only your own stars.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'starred_messages' and policyname = 'remove my stars') then
    create policy "remove my stars" on public.starred_messages for delete to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

-- Disappearing messages: every minute, remove messages whose time is up.
create or replace function public.purge_expired_messages()
returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  delete from public.messages where expires_at is not null and expires_at <= now() - interval '1 minute';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.purge_expired_messages() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'atomshade-purge-expired') then
    perform cron.schedule('atomshade-purge-expired', '* * * * *', 'select public.purge_expired_messages()');
  end if;
end $$;

-- Delete my account: removes you, your messages, statuses, keys and settings for good.
-- The person must type DELETE to confirm. Chats you started stay for the other people.
create or replace function public.delete_my_account(p_confirm text)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  g record;
  next_admin uuid;
begin
  if uid is null then raise exception 'Please log in first'; end if;
  if p_confirm is distinct from 'DELETE' then raise exception 'Type DELETE to confirm'; end if;

  -- Groups with no admin left get the longest-standing member as admin.
  for g in
    select c.id from public.conversations c
    join public.conversation_members m on m.conversation_id = c.id and m.user_id = uid and m.role = 'admin'
    where c.is_group
      and not exists (select 1 from public.conversation_members x
                      where x.conversation_id = c.id and x.user_id <> uid and x.role = 'admin')
  loop
    select x.user_id into next_admin from public.conversation_members x
      where x.conversation_id = g.id and x.user_id <> uid
      order by x.last_read_at nulls last, x.user_id limit 1;
    if next_admin is not null then
      update public.conversation_members set role = 'admin'
        where conversation_id = g.id and user_id = next_admin;
    end if;
  end loop;

  -- Conversations nobody else is in disappear with you; others keep theirs.
  delete from public.conversations c
   where not exists (select 1 from public.conversation_members x where x.conversation_id = c.id and x.user_id <> uid)
     and exists (select 1 from public.conversation_members y where y.conversation_id = c.id and y.user_id = uid);
  update public.conversations set created_by = null where created_by = uid;
  delete from public.messages where sender_id = uid;

  delete from auth.users where id = uid;
end;
$$;
revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;
