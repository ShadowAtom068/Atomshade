-- ATOMSHADE: repair for "Message not sent: new row violates row-level security policy".
-- Run this once in Supabase -> SQL Editor. It is safe to run more than once.
-- It puts back the three things a message needs in order to be sent:
--   1. the check "is this person inside this chat?"
--   2. the sender being filled in automatically as the logged-in person
--   3. the rules for reading, sending and marking messages as delivered/read

-- Only create the "is this person in the chat" check if it is missing.
-- (If it already exists we leave it alone, so nothing that uses it breaks.)
do $do$
begin
  if to_regprocedure('public.is_member(uuid)') is null then
    execute $f$
      create function public.is_member(conv uuid)
      returns boolean
      language sql
      security definer
      stable
      set search_path = public
      as $body$
        select exists (
          select 1 from public.conversation_members cm
          where cm.conversation_id = $1 and cm.user_id = auth.uid()
        );
      $body$
    $f$;
  end if;
end
$do$;

alter table public.messages alter column sender_id set default auth.uid();
alter table public.messages enable row level security;

drop policy if exists "read messages in my conversations" on public.messages;
create policy "read messages in my conversations"
  on public.messages for select to authenticated
  using (public.is_member(conversation_id));

drop policy if exists "send messages as myself" on public.messages;
create policy "send messages as myself"
  on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(conversation_id));

drop policy if exists "mark received messages delivered or read" on public.messages;
create policy "mark received messages delivered or read"
  on public.messages for update to authenticated
  using (public.is_member(conversation_id) and sender_id <> auth.uid());

-- The same idea for the chat list itself, in case those rules went missing too.
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;

drop policy if exists "see my conversations" on public.conversations;
create policy "see my conversations"
  on public.conversations for select to authenticated using (public.is_member(id));

drop policy if exists "see members of my conversations" on public.conversation_members;
create policy "see members of my conversations"
  on public.conversation_members for select to authenticated using (public.is_member(conversation_id));

grant select, insert on public.messages to authenticated;
grant update (delivered_at, read_at) on public.messages to authenticated;
