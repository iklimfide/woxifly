-- "permission denied for table profiles" (42501)
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.
--
-- Olası nedenler: authenticated rolüne tablo yetkisi yok veya RLS politikaları eksik
-- (migration-security-hardening sonrası yalnızca profile_directory + kısıtlı SELECT).

grant usage on schema public to authenticated;

grant select, insert, update on table public.profiles to authenticated;

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
on public.profiles for select to authenticated
using (id = auth.uid());

drop policy if exists "profiles: read others directory" on public.profiles;
create policy "profiles: read others directory"
on public.profiles for select to authenticated
using (id <> auth.uid());

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
on public.profiles for insert to authenticated
with check (id = auth.uid());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop view if exists public.profile_directory;

create view public.profile_directory
with (security_invoker = true)
as
select
  id,
  username,
  avatar_url,
  district,
  current_district,
  abroad_city,
  about_me,
  home_location,
  job,
  marital_status
from public.profiles;

grant select on public.profile_directory to authenticated;
