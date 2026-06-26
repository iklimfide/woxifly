-- Kalan linter uyarılarını azaltır (ölü özellikler + platform RPC).
-- migration-security-hardening.sql ve fix-linter-warnings.sql sonrası çalıştırın.
--
-- Bilerek kalacak uyarılar (sorun değil):
--   • authenticated + SECURITY DEFINER → block_user, get_or_create_dm vb.
--   • pg_trgm public şemada → düşük risk

-- ---------------------------------------------------------------------------
-- Yardımcı: fonksiyon varsa revoke et (yoksa atla)
-- ---------------------------------------------------------------------------
create or replace function public._woxifly_revoke_if_exists(p_signature text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regprocedure(p_signature) is null then
    raise notice 'Atlandı (yok): %', p_signature;
    return;
  end if;
  execute format('revoke all on function %s from public, anon, authenticated', p_signature);
exception
  when undefined_function then
    raise notice 'Atlandı (yok): %', p_signature;
  when insufficient_privilege then
    raise notice 'Revoke atlandı (yetki): %', p_signature;
end;
$$;

revoke all on function public._woxifly_revoke_if_exists(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) Grup / radar kaldırıldı
-- ---------------------------------------------------------------------------
select public._woxifly_revoke_if_exists('public.is_group_conversation_for_user(uuid)');
select public._woxifly_revoke_if_exists('public.nearby_users(integer, integer)');
select public._woxifly_revoke_if_exists('public.get_nearby_users(double precision, double precision, double precision)');
select public._woxifly_revoke_if_exists('public.get_nearby_users_by_district(double precision)');
select public._woxifly_revoke_if_exists('public.get_nearby_users_by_district()');
select public._woxifly_revoke_if_exists('public.get_radar_users_without_distance()');
select public._woxifly_revoke_if_exists('public.get_user_district()');

-- ---------------------------------------------------------------------------
-- 2) Supabase platform fonksiyonu
-- ---------------------------------------------------------------------------
select public._woxifly_revoke_if_exists('public.rls_auto_enable()');

-- ---------------------------------------------------------------------------
-- 3) RLS yardımcıları
-- ---------------------------------------------------------------------------
do $rls$
begin
  if to_regprocedure('public.is_dm_participant(uuid)') is not null then
    revoke all on function public.is_dm_participant(uuid) from public, anon;
    grant execute on function public.is_dm_participant(uuid) to authenticated;
  end if;

  if to_regprocedure('public.is_blocked(uuid, uuid)') is not null then
    revoke all on function public.is_blocked(uuid, uuid) from public, anon, authenticated;
  end if;
end;
$rls$;

drop function if exists public._woxifly_revoke_if_exists(text);
