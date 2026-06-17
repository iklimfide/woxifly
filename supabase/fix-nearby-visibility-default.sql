-- Radar görünürlüğü (Beni bul) varsayılan kapalı — yeni profiller için
-- Supabase SQL Editor'da çalıştırın.

alter table public.profiles
  alter column is_visible set default false;

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
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
