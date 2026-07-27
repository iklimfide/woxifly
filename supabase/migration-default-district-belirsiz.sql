-- Varsayılan konum: Belirsiz (kayıtta seçilmemiş üyeler İstanbul Anadolu yerine)
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

insert into public.district_coordinates (city, district, latitude, longitude)
values ('—', 'Belirsiz', 0, 0)
on conflict (district) do update set
  city = excluded.city,
  latitude = 0,
  longitude = 0;

create or replace function public.sync_profile_district()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.current_district, new.district) = 'Belirsiz' then
    new.district := 'Belirsiz';
    new.current_district := 'Belirsiz';
    new.lat := null;
    new.lon := null;
    new.abroad_city := null;
    return new;
  end if;

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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_district text;
  v_username text;
begin
  v_district := coalesce(nullif(trim(new.raw_user_meta_data->>'district'), ''), 'Belirsiz');
  v_username := coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), 'Kullanıcı');

  if not exists (
    select 1 from public.district_coordinates dc where dc.district = v_district
  ) then
    v_district := 'Belirsiz';
  end if;

  insert into public.profiles (id, username, district, current_district, is_visible)
  values (new.id, v_username, v_district, v_district, false)
  on conflict (id) do nothing;

  begin
    perform public.send_welcome_dm(new.id, v_username);
  exception
    when others then
      raise warning 'send_welcome_dm failed for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

create or replace function public.format_profile_location(p_district text, p_abroad_city text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_district, '') in ('', 'Belirsiz') then 'Belirsiz'
    when coalesce(p_district, '') = 'Yurtdışı' then
      case
        when nullif(trim(coalesce(p_abroad_city, '')), '') is not null
          then 'Yurtdışı · ' || trim(p_abroad_city)
        else 'Yurtdışı'
      end
    else p_district
  end;
$$;

-- Eski otomatik varsayılan: profilde konum belirtmemiş üyeler
update public.profiles p
set
  district = 'Belirsiz',
  current_district = 'Belirsiz',
  lat = null,
  lon = null
where coalesce(p.current_district, p.district) = 'İstanbul Anadolu'
  and nullif(trim(coalesce(p.home_location, '')), '') is null;

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
      and coalesce(p.current_district, p.district) not in ('Yurtdışı', 'Belirsiz')
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
    where me.home in ('Yurtdışı', 'Belirsiz')
  )
  union all
  (
    select g.user_id, g.username, g.district, g.distance_km, g.avatar_url
    from me
    cross join lateral public.get_nearby_users(me.lat, me.lon, p_max_km::double precision) g
    where me.home not in ('Yurtdışı', 'Belirsiz')
      and me.lat is not null
      and me.lon is not null
  );
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
