-- Sohbet üyesi herhangi bir mesajı silebilir (gelen + giden)
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

create or replace function public.soft_delete_messages(p_message_ids uuid[])
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

  if p_message_ids is null or cardinality(p_message_ids) = 0 then
    return 0;
  end if;

  update public.messages
  set deleted_at = now()
  where id = any(p_message_ids)
    and deleted_at is null
    and (
      public.is_dm_participant(conversation_id)
      or public.is_group_conversation_for_user(conversation_id)
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.soft_delete_messages(uuid[]) from public, anon;
grant execute on function public.soft_delete_messages(uuid[]) to authenticated;
