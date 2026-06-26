-- DM mesajları ve sohbet listesi boşsa: eksik bağımlılıkları tamamlar ve okuma RLS'ini yeniden kurar.
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.
--
-- Neden: migration-security-hardening.sql "messages: read dm if member" politikasını
-- message_hides / is_dm_partner_blocked olmadan çalıştırılırsa politika oluşmaz → hiç mesaj görünmez.

-- ---------------------------------------------------------------------------
-- 1) message_hides (Benden sil)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2) user_blocks + engel yardımcıları
-- ---------------------------------------------------------------------------
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

drop policy if exists "user_blocks: read own" on public.user_blocks;
create policy "user_blocks: read own"
on public.user_blocks for select to authenticated
using (blocker_id = auth.uid());

drop policy if exists "user_blocks: delete own" on public.user_blocks;
create policy "user_blocks: delete own"
on public.user_blocks for delete to authenticated
using (blocker_id = auth.uid());

create or replace function public.is_blocked(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when auth.uid() <> p_user_a and auth.uid() <> p_user_b then false
    else exists (
      select 1
      from public.user_blocks b
      where (b.blocker_id = p_user_a and b.blocked_id = p_user_b)
         or (b.blocker_id = p_user_b and b.blocked_id = p_user_a)
    )
  end;
$$;

revoke all on function public.is_blocked(uuid, uuid) from public, anon;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;

create or replace function public.is_dm_partner_blocked(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    join public.conversation_members me
      on me.conversation_id = c.id and me.user_id = auth.uid()
    join public.conversation_members other
      on other.conversation_id = c.id and other.user_id <> auth.uid()
    where c.id = p_conversation_id
      and c.type = 'dm'
      and public.is_blocked(me.user_id, other.user_id)
  );
$$;

revoke all on function public.is_dm_partner_blocked(uuid) from public, anon;
grant execute on function public.is_dm_partner_blocked(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Mesaj okuma RLS (DM)
-- ---------------------------------------------------------------------------
drop policy if exists "messages: read dm if member" on public.messages;
create policy "messages: read dm if member"
on public.messages for select to authenticated
using (
  deleted_at is null
  and public.is_dm_participant(conversation_id)
  and not public.is_dm_partner_blocked(conversation_id)
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
      and not public.is_dm_partner_blocked(m.conversation_id)
      and not exists (
        select 1 from public.message_hides mh
        where mh.message_id = m.id and mh.user_id = auth.uid()
      )
  )
);

-- ---------------------------------------------------------------------------
-- 4) hide_messages_for_me (yoksa oluştur)
-- ---------------------------------------------------------------------------
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
    and public.is_dm_participant(m.conversation_id)
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.hide_messages_for_me(uuid[]) from public, anon;
grant execute on function public.hide_messages_for_me(uuid[]) to authenticated;

-- Doğrulama (sonuçta en az bir satır görmelisiniz):
-- select policyname, cmd from pg_policies where tablename = 'messages' and policyname like '%dm%';
