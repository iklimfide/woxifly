-- Mesaj soft delete (7 gün sonra kalıcı silinir)
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

alter table public.messages
  add column if not exists deleted_at timestamptz;

create index if not exists messages_deleted_at_idx
  on public.messages (deleted_at)
  where deleted_at is not null;

-- Okuma: silinmiş mesajları gösterme
drop policy if exists "messages: read dm if member" on public.messages;
create policy "messages: read dm if member"
on public.messages for select to authenticated
using (
  deleted_at is null
  and public.is_dm_participant(conversation_id)
);

drop policy if exists "messages: read group if matches district" on public.messages;
create policy "messages: read group if matches district"
on public.messages for select to authenticated
using (
  deleted_at is null
  and public.is_group_conversation_for_user(conversation_id)
);

drop policy if exists "messages: anon read group" on public.messages;
create policy "messages: anon read group"
on public.messages for select to anon
using (
  deleted_at is null
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.type = 'group'
  )
);

-- Tepki okuma: silinmiş mesajlara ait tepkileri gizle
drop policy if exists "reactions: read dm if member" on public.message_reactions;
create policy "reactions: read dm if member"
on public.message_reactions for select to authenticated
using (
  exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and m.deleted_at is null
      and public.is_dm_participant(m.conversation_id)
  )
);

drop policy if exists "reactions: read group if matches district" on public.message_reactions;
create policy "reactions: read group if matches district"
on public.message_reactions for select to authenticated
using (
  exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and m.deleted_at is null
      and public.is_group_conversation_for_user(m.conversation_id)
  )
);

drop policy if exists "reactions: anon read group" on public.message_reactions;
create policy "reactions: anon read group"
on public.message_reactions for select to anon
using (
  exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = message_reactions.message_id
      and m.deleted_at is null
      and c.type = 'group'
  )
);

-- Tekli / toplu soft delete RPC
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

-- 7 gün sonra kalıcı silme: kullanıcı silmeleri deleted_at + eski mesajlar created_at
do $woxifly$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid from cron.job where jobname = 'woxifly-purge-messages-7d'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end;
$woxifly$;

select cron.schedule(
  'woxifly-purge-messages-7d',
  '0 3 * * *',
  $$
    delete from public.messages
    where (deleted_at is not null and deleted_at < now() - interval '7 days')
       or (deleted_at is null and created_at < now() - interval '7 days');
  $$
);

comment on column public.messages.deleted_at is
  'Soft delete zaman damgası; 7 gün sonra pg_cron ile kalıcı silinir ve R2 kuyruğuna alınır.';
