-- Profil fotoğrafı alanları
alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists avatar_r2_key text;
