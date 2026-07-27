-- Profil davet kodu (paylaşım linki: /davet/KOD)
-- Supabase SQL Editor'da bir kez çalıştırın.

create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  attempt int := 0;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where invite_code = code);
    attempt := attempt + 1;
    if attempt > 50 then
      raise exception 'invite_code generation failed';
    end if;
  end loop;
  return code;
end;
$$;

alter table public.profiles
  add column if not exists invite_code text;

update public.profiles
set invite_code = public.generate_invite_code()
where invite_code is null or trim(invite_code) = '';

alter table public.profiles
  alter column invite_code set not null;

create unique index if not exists profiles_invite_code_unique
  on public.profiles (invite_code);

create or replace function public.profiles_assign_invite_code()
returns trigger
language plpgsql
as $$
begin
  if new.invite_code is null or trim(new.invite_code) = '' then
    new.invite_code := public.generate_invite_code();
  else
    new.invite_code := upper(trim(new.invite_code));
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_invite_code_before_insert on public.profiles;
create trigger profiles_invite_code_before_insert
  before insert on public.profiles
  for each row execute function public.profiles_assign_invite_code();

create or replace function public.ensure_my_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    return null;
  end if;

  select invite_code into v_code
  from public.profiles
  where id = auth.uid();

  if v_code is not null and trim(v_code) <> '' then
    return v_code;
  end if;

  v_code := public.generate_invite_code();
  update public.profiles
  set invite_code = v_code
  where id = auth.uid();

  return v_code;
end;
$$;

revoke all on function public.ensure_my_invite_code() from public;
grant execute on function public.ensure_my_invite_code() to authenticated;

create or replace function public.resolve_profile_by_invite_code(p_code text)
returns table (
  id uuid,
  username text,
  avatar_url text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_norm text;
begin
  v_norm := upper(trim(coalesce(p_code, '')));
    if v_norm !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    return;
  end if;

  return query
  select p.id, p.username, p.avatar_url
  from public.profiles p
  where p.invite_code = v_norm
  limit 1;
end;
$$;

revoke all on function public.resolve_profile_by_invite_code(text) from public;
grant execute on function public.resolve_profile_by_invite_code(text) to authenticated;

revoke all on function public.generate_invite_code() from public, anon, authenticated;
