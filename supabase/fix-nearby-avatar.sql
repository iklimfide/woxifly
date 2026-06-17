-- Radar kartlarında profil fotoğrafı için get_nearby_users'a avatar_url ekler
-- Supabase SQL Editor'da çalıştırın.
--
-- Dönüş tipi değiştiği için önce DROP gerekir (PostgreSQL 42P13).

drop function if exists public.nearby_users(integer, integer);
drop function if exists public.get_nearby_users(double precision, double precision, double precision);

create or replace function public.get_nearby_users(
  my_lat double precision,
  my_lon double precision,
  max_dist_km double precision
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
  select
    p.id as user_id,
    p.username,
    coalesce(p.current_district, p.district) as district,
    round(
      public.haversine_km(my_lat, my_lon, dc.latitude, dc.longitude)
    )::int as distance_km,
    p.avatar_url
  from public.profiles p
  inner join public.district_coordinates dc
    on dc.district = coalesce(p.current_district, p.district)
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.is_visible = true
    and my_lat is not null
    and my_lon is not null
    and max_dist_km > 0
    and public.haversine_km(my_lat, my_lon, dc.latitude, dc.longitude) <= max_dist_km
  order by distance_km asc
  limit 50;
$$;

create or replace function public.nearby_users(p_min_km int, p_max_km int)
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
  cross join lateral public.get_nearby_users(me.lat, me.lon, p_max_km::double precision) g;
$$;

revoke all on function public.get_nearby_users(double precision, double precision, double precision) from public, anon;
grant execute on function public.get_nearby_users(double precision, double precision, double precision) to authenticated;

revoke all on function public.nearby_users(integer, integer) from public, anon;
grant execute on function public.nearby_users(integer, integer) to authenticated;
