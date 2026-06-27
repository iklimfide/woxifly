-- Tepki (message_reactions) 403: permission denied for is_group_conversation_for_user
-- Grup özelliği kaldırıldı; insert/update politikaları hâlâ o fonksiyonu çağırıyordu.
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

drop policy if exists "reactions: insert own" on public.message_reactions;
create policy "reactions: insert own"
on public.message_reactions for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and m.deleted_at is null
      and public.is_dm_participant(m.conversation_id)
      and not public.is_dm_partner_blocked(m.conversation_id)
  )
);

drop policy if exists "reactions: update own" on public.message_reactions;
create policy "reactions: update own"
on public.message_reactions for update to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and m.deleted_at is null
      and public.is_dm_participant(m.conversation_id)
      and not public.is_dm_partner_blocked(m.conversation_id)
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and m.deleted_at is null
      and public.is_dm_participant(m.conversation_id)
      and not public.is_dm_partner_blocked(m.conversation_id)
  )
);

drop policy if exists "reactions: delete own" on public.message_reactions;
create policy "reactions: delete own"
on public.message_reactions for delete to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and m.deleted_at is null
      and public.is_dm_participant(m.conversation_id)
      and not public.is_dm_partner_blocked(m.conversation_id)
  )
);

-- Okuma (DM) — fix-restore-dm-access ile uyumlu
drop policy if exists "reactions: read dm if member" on public.message_reactions;
create policy "reactions: read dm if member"
on public.message_reactions for select to authenticated
using (
  exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and m.deleted_at is null
      and public.is_dm_participant(m.conversation_id)
      and not public.is_dm_partner_blocked(m.conversation_id)
      and not exists (
        select 1 from public.message_hides mh
        where mh.message_id = m.id and mh.user_id = auth.uid()
      )
  )
);

drop policy if exists "reactions: read group if matches district" on public.message_reactions;
drop policy if exists "reactions: anon read group" on public.message_reactions;

grant execute on function public.is_dm_participant(uuid) to authenticated;
