-- Woxifly Supabase şeması
-- Supabase Dashboard > SQL Editor'da çalıştırın.
--
-- E-posta doğrulaması (şimdilik kapalı):
-- Authentication > Providers > Email > "Confirm email" seçeneğini KAPATIN.
-- Böylece kayıt sonrası kullanıcı doğrudan giriş yapabilir.

-- PROFILES
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 2 and 24),
  district text not null check (char_length(district) between 2 and 40),
  lat double precision,
  lon double precision,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
on public.profiles for select to authenticated
using (id = auth.uid());

drop policy if exists "profiles: read public fields" on public.profiles;
create policy "profiles: read public fields"
on public.profiles for select to authenticated
using (true);

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
on public.profiles for insert to authenticated
with check (id = auth.uid());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create index if not exists profiles_district_idx on public.profiles (district);
create index if not exists profiles_lat_lon_idx on public.profiles (lat, lon);

-- Yeni kullanıcı kaydında profil oluştur
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, district, lat, lon)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'Kullanıcı'),
    coalesce(new.raw_user_meta_data->>'district', 'Kadıköy'),
    (new.raw_user_meta_data->>'lat')::double precision,
    (new.raw_user_meta_data->>'lon')::double precision
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- CONVERSATIONS
do $$ begin
  if not exists (select 1 from pg_type where typname = 'conversation_type') then
    create type public.conversation_type as enum ('group', 'dm');
  end if;
end $$;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type public.conversation_type not null,
  district text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint conversations_group_district_chk
    check ((type = 'group' and district is not null) or (type = 'dm' and district is null))
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create index if not exists messages_conv_created_idx on public.messages (conversation_id, created_at);
create index if not exists conv_members_user_idx on public.conversation_members (user_id);

-- RLS yardımcıları (özyinelemeyi önler)
create or replace function public.is_dm_participant(p_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members
    where conversation_id = p_conversation_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.get_user_district()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select district from public.profiles where id = auth.uid();
$$;

create or replace function public.is_group_conversation_for_user(p_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and c.type = 'group'
      and c.district = public.get_user_district()
  );
$$;

revoke all on function public.is_dm_participant(uuid) from public, anon;
grant execute on function public.is_dm_participant(uuid) to authenticated;
revoke all on function public.get_user_district() from public, anon;
grant execute on function public.get_user_district() to authenticated;
revoke all on function public.is_group_conversation_for_user(uuid) from public, anon;
grant execute on function public.is_group_conversation_for_user(uuid) to authenticated;

-- RLS: conversations
drop policy if exists "conversations: read dm if member" on public.conversations;
create policy "conversations: read dm if member"
on public.conversations for select to authenticated
using (type = 'dm' and public.is_dm_participant(id));

drop policy if exists "conversations: read group if matches district" on public.conversations;
create policy "conversations: read group if matches district"
on public.conversations for select to authenticated
using (type = 'group' and district = public.get_user_district());

-- RLS: conversation_members
drop policy if exists "members: read if can read conversation" on public.conversation_members;
drop policy if exists "members: read dm if participant" on public.conversation_members;
create policy "members: read dm if participant"
on public.conversation_members for select to authenticated
using (public.is_dm_participant(conversation_id));

-- RLS: messages read
drop policy if exists "messages: read dm if member" on public.messages;
create policy "messages: read dm if member"
on public.messages for select to authenticated
using (public.is_dm_participant(conversation_id));

drop policy if exists "messages: read group if matches district" on public.messages;
create policy "messages: read group if matches district"
on public.messages for select to authenticated
using (public.is_group_conversation_for_user(conversation_id));

-- RLS: messages insert
drop policy if exists "messages: insert own dm if member" on public.messages;
create policy "messages: insert own dm if member"
on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_dm_participant(conversation_id)
);

drop policy if exists "messages: insert own group if matches district" on public.messages;
create policy "messages: insert own group if matches district"
on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_group_conversation_for_user(conversation_id)
);

-- RPC: grup odası bul/oluştur
create or replace function public.get_or_create_group_conversation(p_district text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select c.id into v_id
  from public.conversations c
  where c.type = 'group' and c.district = p_district
  limit 1;

  if v_id is null then
    insert into public.conversations (type, district, created_by)
    values ('group', p_district, auth.uid())
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.get_or_create_group_conversation(text) from public, anon;
grant execute on function public.get_or_create_group_conversation(text) to authenticated;

-- RPC: DM bul/oluştur
create or replace function public.get_or_create_dm(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if p_other is null or p_other = v_me then
    raise exception 'invalid other user';
  end if;

  select c.id into v_id
  from public.conversations c
  where c.type = 'dm'
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = v_me)
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = p_other)
  limit 1;

  if v_id is null then
    insert into public.conversations (type, created_by) values ('dm', v_me) returning id into v_id;
    insert into public.conversation_members (conversation_id, user_id) values (v_id, v_me), (v_id, p_other);
  end if;

  return v_id;
end;
$$;

revoke all on function public.get_or_create_dm(uuid) from public, anon;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

-- Haversine
create or replace function public.haversine_km(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
returns double precision
language sql
immutable
set search_path = public
as $$
  select 6371.0 * 2 * asin(
    sqrt(
      power(sin(radians((lat2 - lat1) / 2)), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians((lon2 - lon1) / 2)), 2)
    )
  );
$$;

create or replace function public.nearby_users(p_min_km int, p_max_km int)
returns table (
  user_id uuid,
  username text,
  district text,
  distance_km int
)
language sql
security definer
set search_path = public
as $$
  with me as (
    select id, lat, lon from public.profiles where id = auth.uid()
  )
  select
    p.id as user_id,
    p.username,
    p.district,
    round(public.haversine_km(me.lat, me.lon, p.lat, p.lon))::int as distance_km
  from public.profiles p, me
  where p.id <> me.id
    and me.lat is not null and me.lon is not null
    and p.lat is not null and p.lon is not null
    and public.haversine_km(me.lat, me.lon, p.lat, p.lon) > p_min_km
    and public.haversine_km(me.lat, me.lon, p.lat, p.lon) <= p_max_km
  order by distance_km asc
  limit 50;
$$;

revoke all on function public.nearby_users(int,int) from public, anon;
grant execute on function public.nearby_users(int,int) to authenticated;

revoke all on function public.haversine_km(
  double precision, double precision, double precision, double precision
) from public, anon, authenticated;

-- Realtime: Supabase Dashboard > Project Settings > Realtime
-- "Broadcast" ve "Presence" özelliklerini etkinleştirin.
-- Postgres Changes / messages replication artık gerekmez (Broadcast kullanılıyor).

-- Misafir (giriş yapmamış) kullanıcılar grup mesajlarını okuyabilsin
drop policy if exists "conversations: anon read groups" on public.conversations;
create policy "conversations: anon read groups"
on public.conversations for select to anon
using (type = 'group');

drop policy if exists "messages: anon read group" on public.messages;
create policy "messages: anon read group"
on public.messages for select to anon
using (
  exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.type = 'group'
  )
);

drop policy if exists "profiles: anon read public" on public.profiles;
create policy "profiles: anon read public"
on public.profiles for select to anon
using (true);
