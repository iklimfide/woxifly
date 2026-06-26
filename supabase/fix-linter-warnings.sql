-- Woxifly: Supabase Database Linter uyarılarını azaltır.
-- Supabase Dashboard > SQL Editor'da çalıştırın.
-- migration-security-hardening.sql sonrası çalıştırın.

-- ---------------------------------------------------------------------------
-- 1) search_path sabitle
-- ---------------------------------------------------------------------------
alter function public.haversine_km(
  double precision, double precision, double precision, double precision
) set search_path = public;

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
-- 2) Trigger fonksiyonları — yalnızca trigger tetikler; RPC kapalı
-- ---------------------------------------------------------------------------
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.queue_r2_key_on_message_delete() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) RLS yardımcıları — anon erişimi kapat, authenticated RLS için açık
-- ---------------------------------------------------------------------------
revoke all on function public.is_dm_participant(uuid) from public, anon;
grant execute on function public.is_dm_participant(uuid) to authenticated;

revoke all on function public.get_user_district() from public, anon;
grant execute on function public.get_user_district() to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Uygulama RPC'leri — yalnızca giriş yapmış kullanıcı
-- ---------------------------------------------------------------------------
revoke all on function public.get_or_create_dm(uuid) from public, anon;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

revoke all on function public.is_blocked(uuid, uuid) from public, anon;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;

revoke all on function public.is_dm_partner_blocked(uuid) from public, anon;
grant execute on function public.is_dm_partner_blocked(uuid) to authenticated;

revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

revoke all on function public.list_block_relation_ids() from public, anon;
grant execute on function public.list_block_relation_ids() to authenticated;

revoke all on function public.get_block_status(uuid) from public, anon;
grant execute on function public.get_block_status(uuid) to authenticated;

revoke all on function public.nearby_users(integer, integer) from public, anon;
grant execute on function public.nearby_users(integer, integer) to authenticated;

revoke all on function public.get_nearby_users(double precision, double precision, double precision) from public, anon;
grant execute on function public.get_nearby_users(double precision, double precision, double precision) to authenticated;

revoke all on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;

revoke all on function public.hide_messages_for_me(uuid[]) from public, anon;
grant execute on function public.hide_messages_for_me(uuid[]) to authenticated;

revoke all on function public.soft_delete_messages(uuid[]) from public, anon;
grant execute on function public.soft_delete_messages(uuid[]) to authenticated;

revoke all on function public.is_username_available(text, uuid) from public, anon;
grant execute on function public.is_username_available(text, uuid) to authenticated;

revoke all on function public.sync_profile_district() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) İç yardımcı — doğrudan RPC kapalı
-- ---------------------------------------------------------------------------
revoke all on function public.haversine_km(
  double precision, double precision, double precision, double precision
) from public, anon, authenticated;

-- Bilerek kalan uyarılar (normal):
--   - authenticated + SECURITY DEFINER RPC'ler (uygulama tasarımı)
--   - rls_auto_enable → Supabase platform fonksiyonu (dokunmayın)
--   - pg_trgm public şemada → düşük öncelik
