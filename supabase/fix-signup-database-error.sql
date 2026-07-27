-- "Database error saving new user" — profil tetikleyicisi / rumuz / hoş geldin DM
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

-- Eski auth migration: yalnızca [A-Za-z0-9_-] (Türkçe harf / nokta reddedilir)
alter table public.profiles
  drop constraint if exists username_format;

-- Rumuz kuralı uygulama ile uyumlu (2–24, biçim istemcide doğrulanır)
alter table public.profiles
  drop constraint if exists profiles_username_check;

alter table public.profiles
  add constraint profiles_username_check
  check (char_length(username) >= 2 and char_length(username) <= 24);

drop function if exists public.is_username_available(text, uuid);

create function public.is_username_available(
  p_username text,
  p_exclude uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_norm text;
  v_taken boolean;
begin
  v_norm := lower(trim(coalesce(p_username, '')));
  if char_length(v_norm) < 2 or char_length(v_norm) > 24 then
    return false;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'username_normalized'
  ) then
    if p_exclude is null then
      select exists (
        select 1 from public.profiles where username_normalized = v_norm
      ) into v_taken;
    else
      select exists (
        select 1 from public.profiles
        where username_normalized = v_norm and id <> p_exclude
      ) into v_taken;
    end if;
  else
    if p_exclude is null then
      select exists (
        select 1 from public.profiles where lower(trim(username)) = v_norm
      ) into v_taken;
    else
      select exists (
        select 1 from public.profiles
        where lower(trim(username)) = v_norm and id <> p_exclude
      ) into v_taken;
    end if;
  end if;

  return not coalesce(v_taken, false);
end;
$$;

revoke all on function public.is_username_available(text, uuid) from public;
grant execute on function public.is_username_available(text, uuid) to anon, authenticated;

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
  v_district := coalesce(nullif(trim(new.raw_user_meta_data->>'district'), ''), 'İstanbul Anadolu');
  v_username := coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), 'Kullanıcı');

  if not exists (
    select 1 from public.district_coordinates dc where dc.district = v_district
  ) then
    v_district := 'Kadıköy';
  end if;

  insert into public.profiles (id, username, district, current_district, is_visible)
  values (
    new.id,
    v_username,
    v_district,
    v_district,
    false
  )
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

revoke all on function public.handle_new_user() from public, anon, authenticated;
