-- Yeni üyeye otomatik hoş geldin DM'i
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.
--
-- Gönderici: @Woxifly (0a85b037-f6f3-48fd-a815-85998852095e)
-- Farklı hesap kullanmak için:
--   insert into public.app_settings (key, value)
--   values ('welcome_sender_user_id', 'UUID')
--   on conflict (key) do update set value = excluded.value, updated_at = now();

-- ---------------------------------------------------------------------------
-- Ayarlar (yalnızca security definer fonksiyonlar okur)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

revoke all on table public.app_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hoş geldin DM
-- ---------------------------------------------------------------------------
create or replace function public.send_welcome_dm(p_new_user_id uuid, p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid;
  v_conv uuid;
  v_name text;
  v_body text;
begin
  if p_new_user_id is null then
    return;
  end if;

  select value::uuid into v_sender
  from public.app_settings
  where key = 'welcome_sender_user_id';

  if v_sender is null then
    select id into v_sender
    from public.profiles
    where lower(username) = 'woxifly'
    limit 1;
  end if;

  if v_sender is null then
    return;
  end if;

  if v_sender = p_new_user_id then
    return;
  end if;

  if not exists (select 1 from auth.users where id = v_sender) then
    return;
  end if;

  if not exists (select 1 from auth.users where id = p_new_user_id) then
    return;
  end if;

  -- Zaten bu gönderenden DM varsa tekrar oluşturma
  if exists (
    select 1
    from public.conversations c
    join public.conversation_members me on me.conversation_id = c.id and me.user_id = p_new_user_id
    join public.conversation_members other on other.conversation_id = c.id and other.user_id = v_sender
    where c.type = 'dm'
  ) then
    return;
  end if;

  v_name := coalesce(nullif(trim(p_username), ''), 'Kullanıcı');
  v_body := format(
    'Merhaba %s, Woxifly''a hoş geldiniz. Arkadaşlarınızı woxifly.com''a davet edebilir, profil linkinizi paylaşarak hesap makinesi kamuflajı ile gizlilik içinde sohbet edebilirsiniz. 7 gününü dolduran mesaj geçmişi otomatik silinir.',
    v_name
  );

  insert into public.conversations (type, created_by)
  values ('dm', v_sender)
  returning id into v_conv;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_conv, v_sender), (v_conv, p_new_user_id);

  insert into public.messages (conversation_id, sender_id, body, content_type)
  values (v_conv, v_sender, v_body, 'text');
end;
$$;

revoke all on function public.send_welcome_dm(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Kayıt tetikleyicisi: profil oluşturulduktan sonra hoş geldin gönder
-- ---------------------------------------------------------------------------
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
  v_district := coalesce(new.raw_user_meta_data->>'district', 'Kadıköy');
  v_username := coalesce(new.raw_user_meta_data->>'username', 'Kullanıcı');

  insert into public.profiles (id, username, district, current_district, is_visible)
  values (
    new.id,
    v_username,
    v_district,
    v_district,
    false
  )
  on conflict (id) do nothing;

  perform public.send_welcome_dm(new.id, v_username);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Master @Woxifly hesabını gönderici olarak kaydet
insert into public.app_settings (key, value)
values ('welcome_sender_user_id', '0a85b037-f6f3-48fd-a815-85998852095e')
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();
