-- profile_directory: SECURITY DEFINER view linter hatasını düzeltir.
-- Supabase SQL Editor'da bir kez çalıştırın.

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

comment on view public.profile_directory is
  'Güvenli profil alanları (security_invoker). Hassas sütunlar profiles tablosunda kalır.';

-- security_invoker view için: başkalarının satırları profiles RLS ile okunabilmeli.
-- Not: profiles tablosuna doğrudan SELECT ile lat/lon vb. hâlâ sızabilir;
-- tam izolasyon için hassas sütunları ayrı tabloya taşımak gerekir.
drop policy if exists "profiles: read others directory" on public.profiles;
create policy "profiles: read others directory"
on public.profiles for select to authenticated
using (id <> auth.uid());
