-- Woxifly: Yakınındakileri Bul mimarisi
-- district_coordinates tablosu, profiles genişletmesi, get_nearby_users RPC
-- Supabase Dashboard > SQL Editor'da çalıştırın.

-- ---------------------------------------------------------------------------
-- A) İlçe koordinat tablosu
-- ---------------------------------------------------------------------------
create table if not exists public.district_coordinates (
  id serial primary key,
  city varchar(80) not null default 'İstanbul',
  district varchar(80) not null unique,
  latitude double precision not null,
  longitude double precision not null
);

alter table public.district_coordinates enable row level security;

drop policy if exists "district_coordinates: read all" on public.district_coordinates;
create policy "district_coordinates: read all"
on public.district_coordinates for select
to anon, authenticated
using (true);

-- İstanbul ilçe koordinatları (config.js ile senkron)
insert into public.district_coordinates (city, district, latitude, longitude) values
  ('İstanbul', 'Adalar', 40.874, 29.094),
  ('İstanbul', 'Arnavutköy', 41.183, 28.739),
  ('İstanbul', 'Ataşehir', 40.983, 29.124),
  ('İstanbul', 'Avcılar', 40.979, 28.722),
  ('İstanbul', 'Bağcılar', 41.039, 28.856),
  ('İstanbul', 'Bahçelievler', 41.002, 28.859),
  ('İstanbul', 'Bakırköy', 40.978, 28.874),
  ('İstanbul', 'Başakşehir', 41.093, 28.802),
  ('İstanbul', 'Bayrampaşa', 41.039, 28.914),
  ('İstanbul', 'Beşiktaş', 41.042, 29.007),
  ('İstanbul', 'Beykoz', 41.143, 29.091),
  ('İstanbul', 'Beylikdüzü', 41.002, 28.642),
  ('İstanbul', 'Beyoğlu', 41.037, 28.985),
  ('İstanbul', 'Büyükçekmece', 41.021, 28.585),
  ('İstanbul', 'Çatalca', 41.143, 28.461),
  ('İstanbul', 'Çekmeköy', 41.033, 29.178),
  ('İstanbul', 'Esenler', 41.043, 28.876),
  ('İstanbul', 'Esenyurt', 41.034, 28.680),
  ('İstanbul', 'Eyüpsultan', 41.171, 28.934),
  ('İstanbul', 'Fatih', 41.019, 28.940),
  ('İstanbul', 'Gaziosmanpaşa', 41.064, 28.913),
  ('İstanbul', 'Güngören', 41.025, 28.872),
  ('İstanbul', 'Kadıköy', 40.991, 29.028),
  ('İstanbul', 'Kağıthane', 41.080, 28.975),
  ('İstanbul', 'Kartal', 40.906, 29.187),
  ('İstanbul', 'Küçükçekmece', 41.000, 28.799),
  ('İstanbul', 'Maltepe', 40.934, 29.147),
  ('İstanbul', 'Pendik', 40.878, 29.234),
  ('İstanbul', 'Sancaktepe', 41.002, 29.230),
  ('İstanbul', 'Sarıyer', 41.168, 29.057),
  ('İstanbul', 'Silivri', 41.073, 28.247),
  ('İstanbul', 'Sultanbeyli', 40.960, 29.264),
  ('İstanbul', 'Sultangazi', 41.106, 28.868),
  ('İstanbul', 'Şile', 41.176, 29.613),
  ('İstanbul', 'Şişli', 41.060, 28.987),
  ('İstanbul', 'Tuzla', 40.817, 29.300),
  ('İstanbul', 'Ümraniye', 41.025, 29.110),
  ('İstanbul', 'Üsküdar', 41.024, 29.016),
  ('İstanbul', 'Zeytinburnu', 41.003, 28.907)
on conflict (district) do update set
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  city = excluded.city;

create index if not exists district_coordinates_city_idx on public.district_coordinates (city);

-- ---------------------------------------------------------------------------
-- B) profiles genişletmesi: current_district FK + is_visible
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists current_district varchar(80) references public.district_coordinates (district);

alter table public.profiles
  add column if not exists is_visible boolean not null default true;

-- Mevcut district değerlerini current_district'e taşı
update public.profiles p
set current_district = p.district
where p.current_district is null
  and exists (
    select 1 from public.district_coordinates dc where dc.district = p.district
  );

update public.profiles p
set current_district = 'Kadıköy'
where p.current_district is null;

-- district sütununu current_district ile senkron tut
create or replace function public.sync_profile_district()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.current_district is not null then
    new.district := new.current_district;
    select dc.latitude, dc.longitude
    into new.lat, new.lon
    from public.district_coordinates dc
    where dc.district = new.current_district;
  elsif new.district is not null and new.current_district is null then
    new.current_district := new.district;
    select dc.latitude, dc.longitude
    into new.lat, new.lon
    from public.district_coordinates dc
    where dc.district = new.district;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_sync_district on public.profiles;
create trigger trg_profiles_sync_district
  before insert or update of district, current_district on public.profiles
  for each row
  execute function public.sync_profile_district();

revoke all on function public.sync_profile_district() from public, anon, authenticated;

-- get_user_district: current_district öncelikli
create or replace function public.get_user_district()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(current_district, district)
  from public.profiles
  where id = auth.uid();
$$;

-- Yeni kullanıcı kaydında profil oluştur (güncellenmiş)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_district text;
begin
  v_district := coalesce(new.raw_user_meta_data->>'district', 'Kadıköy');

  insert into public.profiles (id, username, district, current_district, is_visible)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'Kullanıcı'),
    v_district,
    v_district,
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- C) get_nearby_users RPC — Haversine sunucu tarafında
-- ---------------------------------------------------------------------------
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

revoke all on function public.get_nearby_users(double precision, double precision, double precision)
  from public, anon;
grant execute on function public.get_nearby_users(double precision, double precision, double precision)
  to authenticated;

-- Eski nearby_users → get_nearby_users sarmalayıcı (geriye uyumluluk)
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

revoke all on function public.nearby_users(integer, integer) from public, anon;
grant execute on function public.nearby_users(integer, integer) to authenticated;
