-- Benden sil / Herkesten sil ayrımı
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

create table if not exists public.message_hides (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_hides_user_idx on public.message_hides (user_id);

alter table public.message_hides enable row level security;

drop policy if exists "message_hides: read own" on public.message_hides;
create policy "message_hides: read own"
on public.message_hides for select to authenticated
using (user_id = auth.uid());

drop policy if exists "message_hides: insert own" on public.message_hides;
create policy "message_hides: insert own"
on public.message_hides for insert to authenticated
with check (user_id = auth.uid());

-- Benden sil: yalnızca kullanıcının görünümünden kaldırır
create or replace function public.hide_messages_for_me(p_message_ids uuid[])
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

  insert into public.message_hides (message_id, user_id)
  select m.id, auth.uid()
  from public.messages m
  where m.id = any(p_message_ids)
    and m.deleted_at is null
    and (
      public.is_dm_participant(m.conversation_id)
      or public.is_group_conversation_for_user(m.conversation_id)
    )
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.hide_messages_for_me(uuid[]) from public, anon;
grant execute on function public.hide_messages_for_me(uuid[]) to authenticated;

-- Herkesten sil: yalnızca kendi gönderdiğiniz mesajlar
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
    and sender_id = auth.uid()
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

-- Okuma: benden silinen mesajları gösterme
drop policy if exists "messages: read dm if member" on public.messages;
create policy "messages: read dm if member"
on public.messages for select to authenticated
using (
  deleted_at is null
  and public.is_dm_participant(conversation_id)
  and not exists (
    select 1 from public.message_hides mh
    where mh.message_id = messages.id and mh.user_id = auth.uid()
  )
);

drop policy if exists "messages: read group if matches district" on public.messages;
create policy "messages: read group if matches district"
on public.messages for select to authenticated
using (
  deleted_at is null
  and public.is_group_conversation_for_user(conversation_id)
  and not exists (
    select 1 from public.message_hides mh
    where mh.message_id = messages.id and mh.user_id = auth.uid()
  )
);

drop policy if exists "reactions: read dm if member" on public.message_reactions;
create policy "reactions: read dm if member"
on public.message_reactions for select to authenticated
using (
  exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and m.deleted_at is null
      and public.is_dm_participant(m.conversation_id)
      and not exists (
        select 1 from public.message_hides mh
        where mh.message_id = m.id and mh.user_id = auth.uid()
      )
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
      and not exists (
        select 1 from public.message_hides mh
        where mh.message_id = m.id and mh.user_id = auth.uid()
      )
  )
);
