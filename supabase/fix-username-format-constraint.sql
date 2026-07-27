-- Profil kaydı: username_format (ASCII-only) uygulamadaki rumuz kurallarıyla çakışır.
-- Supabase SQL Editor'da çalıştırın.

alter table public.profiles
  drop constraint if exists username_format;

alter table public.profiles
  drop constraint if exists profiles_username_check;

alter table public.profiles
  add constraint profiles_username_check
  check (char_length(username) >= 2 and char_length(username) <= 24);
