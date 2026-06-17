-- RLS sonsuz özyineleme düzeltmesi
-- Supabase SQL Editor'da çalıştırın.

-- Yardımcı fonksiyonlar (RLS bypass ile güvenli kontrol)
create or replace function public.is_dm_participant(p_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members
    where conversation_id = p_conversation_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.get_user_district()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select district from public.profiles where id = auth.uid();
$$;

create or replace function public.is_group_conversation_for_user(p_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and c.type = 'group'
      and c.district = public.get_user_district()
  );
$$;

revoke all on function public.is_dm_participant(uuid) from public, anon;
grant execute on function public.is_dm_participant(uuid) to authenticated;

revoke all on function public.get_user_district() from public, anon;
grant execute on function public.get_user_district() to authenticated;

revoke all on function public.is_group_conversation_for_user(uuid) from public, anon;
grant execute on function public.is_group_conversation_for_user(uuid) to authenticated;

-- CONVERSATIONS
drop policy if exists "conversations: read dm if member" on public.conversations;
create policy "conversations: read dm if member"
on public.conversations for select to authenticated
using (type = 'dm' and public.is_dm_participant(id));

drop policy if exists "conversations: read group if matches district" on public.conversations;
create policy "conversations: read group if matches district"
on public.conversations for select to authenticated
using (type = 'group' and district = public.get_user_district());

-- CONVERSATION_MEMBERS (özyineleme kaldırıldı)
drop policy if exists "members: read if can read conversation" on public.conversation_members;
drop policy if exists "members: read dm if participant" on public.conversation_members;
create policy "members: read dm if participant"
on public.conversation_members for select to authenticated
using (public.is_dm_participant(conversation_id));

-- MESSAGES read
drop policy if exists "messages: read dm if member" on public.messages;
create policy "messages: read dm if member"
on public.messages for select to authenticated
using (public.is_dm_participant(conversation_id));

drop policy if exists "messages: read group if matches district" on public.messages;
create policy "messages: read group if matches district"
on public.messages for select to authenticated
using (public.is_group_conversation_for_user(conversation_id));

-- MESSAGES insert
drop policy if exists "messages: insert own dm if member" on public.messages;
create policy "messages: insert own dm if member"
on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_dm_participant(conversation_id)
);

drop policy if exists "messages: insert own group if matches district" on public.messages;
create policy "messages: insert own group if matches district"
on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_group_conversation_for_user(conversation_id)
);
