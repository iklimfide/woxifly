-- Woxifly güvenlik sertleştirme (DM odaklı; grup/oda kaldırıldı)
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.
--
-- ÖNCE çalıştırın: migration-user-blocks.sql, migration-message-delete-for-me.sql
-- Mesajlar kaybolursa: fix-restore-dm-access.sql

-- ---------------------------------------------------------------------------
-- 1) Profiller: hassas sütunları gizle, herkese açık dizin görünümü
-- ---------------------------------------------------------------------------
drop policy if exists "profiles: read public fields" on public.profiles;
drop policy if exists "profiles: anon read public" on public.profiles;

revoke all on table public.profiles from anon;

drop view if exists public.profile_directory;

create view public.profile_directory
with (security_invoker = true)
as
select
  id,
  username,
  avatar_url,
  district,
  current_district,
  abroad_city,
  about_me,
  home_location,
  job,
  marital_status
from public.profiles;

grant select on public.profile_directory to authenticated;

drop policy if exists "profiles: read others directory" on public.profiles;
create policy "profiles: read others directory"
on public.profiles for select to authenticated
using (id <> auth.uid());

comment on view public.profile_directory is
  'Diğer kullanıcılar için güvenli profil alanları (lat/lon, push_enabled, avatar_r2_key yok).';

-- ---------------------------------------------------------------------------
-- 2) Grup / anon sohbet erişimini kapat (özellik kaldırıldı)
-- ---------------------------------------------------------------------------
drop policy if exists "conversations: anon read groups" on public.conversations;
drop policy if exists "conversations: read group if matches district" on public.conversations;
drop policy if exists "messages: anon read group" on public.messages;
drop policy if exists "messages: read group if matches district" on public.messages;
drop policy if exists "messages: insert own group if matches district" on public.messages;
drop policy if exists "reactions: anon read group" on public.message_reactions;
drop policy if exists "reactions: read group if matches district" on public.message_reactions;

revoke all on function public.get_or_create_group_conversation(text) from public, anon, authenticated;
revoke all on function public.get_group_conversation_id(text) from public, anon, authenticated;
revoke all on function public.get_public_group_messages(text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Engelleme: is_blocked kapsamı + DM okuma
-- ---------------------------------------------------------------------------
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
-- 4) Mesaj silme: yalnızca kendi mesajını herkesten sil
-- ---------------------------------------------------------------------------
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
    and public.is_dm_participant(conversation_id)
    and not public.is_dm_partner_blocked(conversation_id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.soft_delete_messages(uuid[]) from public, anon;
grant execute on function public.soft_delete_messages(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) search_path sabitle (linter)
-- ---------------------------------------------------------------------------
do $fix$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'normalize_username_slug',
        'profiles_set_username_slug',
        'format_profile_location'
      )
  loop
    execute format('alter function %s set search_path = public', fn.sig);
  end loop;
end;
$fix$;

-- ---------------------------------------------------------------------------
-- 6) Ek RPC sertleştirme
-- ---------------------------------------------------------------------------
revoke all on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;

revoke all on function public.hide_messages_for_me(uuid[]) from public, anon;
grant execute on function public.hide_messages_for_me(uuid[]) to authenticated;

revoke all on function public.get_radar_users_without_distance() from public, anon, authenticated;
