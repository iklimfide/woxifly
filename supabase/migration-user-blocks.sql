-- Kullanıcı engelleme
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

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

-- İki yönlü engel kontrolü (RLS / RPC içinden)
create or replace function public.is_blocked(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = p_user_a and b.blocked_id = p_user_b)
       or (b.blocker_id = p_user_b and b.blocked_id = p_user_a)
  );
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

create or replace function public.block_user(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  if p_blocked_id is null or p_blocked_id = v_me then
    raise exception 'invalid user';
  end if;

  if not exists (select 1 from auth.users where id = p_blocked_id) then
    raise exception 'user not found';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_me, p_blocked_id)
  on conflict do nothing;
end;
$$;

revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

create or replace function public.unblock_user(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  delete from public.user_blocks
  where blocker_id = v_me and blocked_id = p_blocked_id;
end;
$$;

revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

create or replace function public.list_block_relation_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct u), '{}'::uuid[])
  from (
    select blocked_id as u
    from public.user_blocks
    where blocker_id = auth.uid()
    union
    select blocker_id as u
    from public.user_blocks
    where blocked_id = auth.uid()
  ) s;
$$;

revoke all on function public.list_block_relation_ids() from public, anon;
grant execute on function public.list_block_relation_ids() to authenticated;

create or replace function public.get_block_status(p_other uuid)
returns table (blocked_by_me boolean, blocked_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.user_blocks
      where blocker_id = auth.uid() and blocked_id = p_other
    ) as blocked_by_me,
    exists (
      select 1 from public.user_blocks
      where blocker_id = p_other and blocked_id = auth.uid()
    ) as blocked_me;
$$;

revoke all on function public.get_block_status(uuid) from public, anon;
grant execute on function public.get_block_status(uuid) to authenticated;

-- DM oluşturma: engelli kullanıcıyla sohbet açılamaz
create or replace function public.get_or_create_dm(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if p_other is null or p_other = v_me then
    raise exception 'invalid other user';
  end if;

  if public.is_blocked(v_me, p_other) then
    raise exception 'Bu kullanıcıyla mesajlaşamazsınız.';
  end if;

  select c.id into v_id
  from public.conversations c
  where c.type = 'dm'
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = v_me)
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = p_other)
  limit 1;

  if v_id is null then
    insert into public.conversations (type, created_by) values ('dm', v_me) returning id into v_id;
    insert into public.conversation_members (conversation_id, user_id) values (v_id, v_me), (v_id, p_other);
  end if;

  return v_id;
end;
$$;

revoke all on function public.get_or_create_dm(uuid) from public, anon;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

-- DM mesaj gönderimi: engel varsa insert reddedilir
drop policy if exists "messages: insert own dm if member" on public.messages;
create policy "messages: insert own dm if member"
on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_dm_participant(conversation_id)
  and not public.is_dm_partner_blocked(conversation_id)
);
