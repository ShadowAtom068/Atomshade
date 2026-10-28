-- ALREADY APPLIED to your live Supabase project. You do not need to run this.
-- Kept only for a fresh project. Makes two old message rules as strict as the new ones.
alter policy "Users can view messages in their conversations." on public.messages
  using (public.is_member(conversation_id) and (deliver_at is null or deliver_at <= now() or sender_id = auth.uid()));
alter policy "Users can send messages to their conversations." on public.messages
  with check (sender_id = auth.uid() and public.can_send_in(conversation_id));
