-- Profil detay alanları: hakkımda, yaşadığı yer, meslek, medeni durum
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

alter table public.profiles
  add column if not exists about_me text,
  add column if not exists home_location text,
  add column if not exists job text,
  add column if not exists marital_status text;

alter table public.profiles
  drop constraint if exists profiles_about_me_chk;

alter table public.profiles
  add constraint profiles_about_me_chk
  check (about_me is null or char_length(trim(about_me)) between 5 and 160);

alter table public.profiles
  drop constraint if exists profiles_home_location_chk;

alter table public.profiles
  add constraint profiles_home_location_chk
  check (home_location is null or char_length(home_location) between 2 and 80);

alter table public.profiles
  drop constraint if exists profiles_job_chk;

alter table public.profiles
  add constraint profiles_job_chk
  check (job is null or char_length(job) between 2 and 80);

alter table public.profiles
  drop constraint if exists profiles_marital_status_chk;

alter table public.profiles
  add constraint profiles_marital_status_chk
  check (marital_status is null or char_length(marital_status) between 2 and 80);
