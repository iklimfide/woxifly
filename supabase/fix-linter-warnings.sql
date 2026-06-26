-- Woxifly: Supabase Database Linter uyarılarını azaltır.
-- Supabase Dashboard > SQL Editor'da çalıştırın.
--
-- Düzeltilenler:
--   - haversine_km search_path
--   - anon rolünün SECURITY DEFINER RPC erişimi
--   - trigger fonksiyonlarının doğrudan çağrılması
--
-- Bilerek kalan uyarılar (normal):
--   - get_or_create_dm, get_or_create_group_conversation, nearby_users
--     → authenticated kullanıcılar RPC ile çağırır (uygulama tasarımı)
--   - is_dm_participant, get_user_district, is_group_conversation_for_user
--     → RLS politikaları authenticated için EXECUTE gerektirir
--   - rls_auto_enable → Supabase platform fonksiyonu (dokunmayın)

-- ---------------------------------------------------------------------------
-- 1) search_path sabitle
-- ---------------------------------------------------------------------------
alter function public.haversine_km(
  double precision, double precision, double precision, double precision
) set search_path = public;

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

revoke all on function public.is_group_conversation_for_user(uuid) from public, anon;
grant execute on function public.is_group_conversation_for_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Uygulama RPC'leri — yalnızca giriş yapmış kullanıcı
-- ---------------------------------------------------------------------------
revoke all on function public.get_or_create_group_conversation(text) from public, anon;
grant execute on function public.get_or_create_group_conversation(text) to authenticated;

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

revoke all on function public.sync_profile_district() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) İç yardımcı — doğrudan RPC kapalı (nearby_users DEFINER içinden çağırır)
-- ---------------------------------------------------------------------------
revoke all on function public.haversine_km(
  double precision, double precision, double precision, double precision
) from public, anon, authenticated;
