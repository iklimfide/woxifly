-- Radar: koordinat istemciden gönderilmez; kullanıcının profil ilçesine göre sunucuda aranır.
-- Supabase SQL Editor'da bir kez çalıştırın.

create or replace function public.get_nearby_users_by_district(
  p_max_dist_km double precision
)
returns table (
  user_id uuid,
  username text,
  district text,
  distance_km int,
  avatar_url text
)
language sql
security definer
stable
set search_path = public
as $$
  with me as (
    select dc.latitude as lat, dc.longitude as lon
    from public.profiles p
    inner join public.district_coordinates dc
      on dc.district = coalesce(p.current_district, p.district)
    where p.id = auth.uid()
  )
  select g.user_id, g.username, g.district, g.distance_km, g.avatar_url
  from me
  cross join lateral public.get_nearby_users(me.lat, me.lon, p_max_dist_km) g;
$$;

revoke all on function public.get_nearby_users_by_district(double precision) from public, anon;
grant execute on function public.get_nearby_users_by_district(double precision) to authenticated;
