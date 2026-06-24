-- Yurtdışı konumu: il listesi, isteğe bağlı şehir, mesafesiz radar
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

insert into public.district_coordinates (city, district, latitude, longitude)
values ('Yurtdışı', 'Yurtdışı', 0, 0)
on conflict (district) do update set
  city = excluded.city,
  latitude = 0,
  longitude = 0;

alter table public.profiles
  add column if not exists abroad_city text;

alter table public.profiles
  drop constraint if exists profiles_abroad_city_chk;

alter table public.profiles
  add constraint profiles_abroad_city_chk
  check (abroad_city is null or char_length(trim(abroad_city)) between 1 and 80);

create or replace function public.sync_profile_district()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.current_district, new.district) = 'Yurtdışı' then
    new.district := 'Yurtdışı';
    new.current_district := 'Yurtdışı';
    new.lat := null;
    new.lon := null;
    if new.abroad_city is not null then
      new.abroad_city := nullif(trim(new.abroad_city), '');
    end if;
    return new;
  end if;

  new.abroad_city := null;

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
  before insert or update of district, current_district, abroad_city on public.profiles
  for each row
  execute function public.sync_profile_district();

drop function if exists public.nearby_users(integer, integer);
drop function if exists public.get_nearby_users(double precision, double precision, double precision);
drop function if exists public.get_radar_users_without_distance();
drop function if exists public.format_profile_location(text, text);

create or replace function public.format_profile_location(p_district text, p_abroad_city text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_district, '') = 'Yurtdışı' then
      case
        when nullif(trim(coalesce(p_abroad_city, '')), '') is not null
          then 'Yurtdışı · ' || trim(p_abroad_city)
        else 'Yurtdışı'
      end
    else p_district
  end;
$$;

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
  select *
  from (
    select
      p.id as user_id,
      p.username,
      public.format_profile_location(
        coalesce(p.current_district, p.district),
        p.abroad_city
      ) as district,
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
      and coalesce(p.current_district, p.district) <> 'Yurtdışı'
      and public.haversine_km(my_lat, my_lon, dc.latitude, dc.longitude) <= max_dist_km

    union all

    select
      p.id as user_id,
      p.username,
      public.format_profile_location(
        coalesce(p.current_district, p.district),
        p.abroad_city
      ) as district,
      null::int as distance_km,
      p.avatar_url
    from public.profiles p
    where auth.uid() is not null
      and p.id <> auth.uid()
      and p.is_visible = true
      and coalesce(p.current_district, p.district) = 'Yurtdışı'
  ) combined
  order by combined.distance_km nulls last, combined.distance_km asc, combined.username asc
  limit 50;
$$;

create or replace function public.get_radar_users_without_distance()
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
    public.format_profile_location(
      coalesce(p.current_district, p.district),
      p.abroad_city
    ) as district,
    null::int as distance_km,
    p.avatar_url
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.is_visible = true
  order by p.username asc
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
    select p.lat, p.lon, coalesce(p.current_district, p.district) as home
    from public.profiles p
    where p.id = auth.uid()
  )
  (
    select g.user_id, g.username, g.district, g.distance_km, g.avatar_url
    from me
    cross join lateral public.get_radar_users_without_distance() g
    where me.home = 'Yurtdışı'
  )
  union all
  (
    select g.user_id, g.username, g.district, g.distance_km, g.avatar_url
    from me
    cross join lateral public.get_nearby_users(me.lat, me.lon, p_max_km::double precision) g
    where me.home <> 'Yurtdışı' and me.lat is not null and me.lon is not null
  );
$$;

revoke all on function public.format_profile_location(text, text) from public, anon, authenticated;
revoke all on function public.get_nearby_users(double precision, double precision, double precision) from public, anon;
grant execute on function public.get_nearby_users(double precision, double precision, double precision) to authenticated;
revoke all on function public.get_radar_users_without_distance() from public, anon;
grant execute on function public.get_radar_users_without_distance() to authenticated;
revoke all on function public.nearby_users(integer, integer) from public, anon;
grant execute on function public.nearby_users(integer, integer) to authenticated;
