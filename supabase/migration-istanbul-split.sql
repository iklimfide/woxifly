-- İstanbul Avrupa / Anadolu ayrımı ve grup oda adı formatı ("{konum} Odası")
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

create or replace function public.set_message_parties()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type public.conversation_type;
  v_district text;
begin
  select coalesce(p.username, 'Kullanıcı')
  into new.sender_username
  from public.profiles p
  where p.id = new.sender_id;

  new.sender_username := coalesce(new.sender_username, 'Kullanıcı');

  select c.type, c.district
  into v_type, v_district
  from public.conversations c
  where c.id = new.conversation_id;

  if v_type = 'dm' then
    select cm.user_id, coalesce(p.username, 'Kullanıcı')
    into new.receiver_id, new.receiver_username
    from public.conversation_members cm
    left join public.profiles p on p.id = cm.user_id
    where cm.conversation_id = new.conversation_id
      and cm.user_id <> new.sender_id
    order by cm.created_at
    limit 1;
  elsif v_type = 'group' then
    new.receiver_id := null;
    new.receiver_username := coalesce(v_district, 'Grup') || ' Odası';
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
begin
  v_district := coalesce(new.raw_user_meta_data->>'district', 'İstanbul Anadolu');

  insert into public.profiles (id, username, district, current_district, is_visible)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'Kullanıcı'),
    v_district,
    v_district,
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.set_message_parties() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
