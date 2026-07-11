-- Sohbet listesinden "Sil": kullanıcının görünümünden tüm DM mesajlarını kaldırır.
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

create or replace function public.hide_dm_conversation_for_me(p_conversation_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_conversation_id is null then
    return 0;
  end if;

  if not exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and c.type = 'dm'
      and public.is_dm_participant(c.id)
  ) then
    raise exception 'conversation not found';
  end if;

  insert into public.message_hides (message_id, user_id)
  select m.id, auth.uid()
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.deleted_at is null
    and not exists (
      select 1
      from public.message_hides mh
      where mh.message_id = m.id
        and mh.user_id = auth.uid()
    )
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.hide_dm_conversation_for_me(uuid) from public, anon;
grant execute on function public.hide_dm_conversation_for_me(uuid) to authenticated;
