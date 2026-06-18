-- messages tablosu sütun sırasını düzeltir (gönderici → alıcı → body → diğerleri)
-- Eksik kolonları ekler, doldurur ve tabloyu hedef sırayla yeniden oluşturur.
--
-- Hedef sıra:
--   id, conversation_id,
--   sender_id, sender_username, receiver_id, receiver_username,
--   body, content_type, media_url, r2_key, client_id, quote, deleted_at, created_at

do $$ begin
  if not exists (select 1 from pg_type where typname = 'message_content_type') then
    create type public.message_content_type as enum ('text', 'image', 'video', 'audio');
  end if;
end $$;

-- Eksik kolonları ekle (reorder öncesi)
alter table public.messages
  add column if not exists sender_username text;

alter table public.messages
  add column if not exists receiver_id uuid references auth.users(id) on delete set null;

alter table public.messages
  add column if not exists receiver_username text;

alter table public.messages
  add column if not exists content_type public.message_content_type not null default 'text';

alter table public.messages
  add column if not exists media_url text;

alter table public.messages
  add column if not exists r2_key text;

alter table public.messages
  add column if not exists client_id text;

alter table public.messages
  add column if not exists quote jsonb;

alter table public.messages
  add column if not exists deleted_at timestamptz;

-- Gönderici backfill
update public.messages m
set sender_username = p.username
from public.profiles p
where p.id = m.sender_id
  and m.sender_username is null;

update public.messages
set sender_username = 'Kullanıcı'
where sender_username is null;

-- DM alıcı backfill
update public.messages m
set
  receiver_id = other.user_id,
  receiver_username = coalesce(p.username, 'Kullanıcı')
from public.conversations c
join public.conversation_members other
  on other.conversation_id = c.id
left join public.profiles p on p.id = other.user_id
where c.id = m.conversation_id
  and c.type = 'dm'
  and m.receiver_id is null
  and other.user_id <> m.sender_id;

-- Grup alıcı backfill
update public.messages m
set receiver_username = coalesce(c.district, 'Grup') || ' Genel Odası'
from public.conversations c
where c.id = m.conversation_id
  and c.type = 'group'
  and m.receiver_username is null;

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
    new.receiver_username := coalesce(v_district, 'Grup') || ' Genel Odası';
  end if;

  return new;
end;
$$;

revoke all on function public.set_message_parties() from public, anon, authenticated;

drop table if exists public.messages_ordered;

create table public.messages_ordered (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  sender_username text not null default 'Kullanıcı',
  receiver_id uuid references auth.users(id) on delete set null,
  receiver_username text,
  body text not null default '',
  content_type public.message_content_type not null default 'text',
  media_url text,
  r2_key text,
  client_id text,
  quote jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint messages_body_chk check (char_length(body) <= 2000),
  constraint messages_body_or_media_chk check (
    (char_length(trim(body)) >= 1)
    or (media_url is not null and char_length(media_url) between 10 and 2048)
  ),
  constraint messages_content_media_consistency_chk check (
    (content_type = 'text' and media_url is null)
    or (content_type <> 'text' and media_url is not null)
  ),
  constraint messages_media_url_path_chk check (
    media_url is null
    or (
      char_length(media_url) between 10 and 2048
      and (
        media_url ~ '^/api/media/uploads/[a-zA-Z0-9._%-/]+$'
        or media_url ~ '^https://[^/]+/uploads/[a-zA-Z0-9._%-/]+$'
        or media_url ~ '^https://[^/]+/[^/]+/uploads/[a-zA-Z0-9._%-/]+$'
      )
    )
  )
);

insert into public.messages_ordered (
  id,
  conversation_id,
  sender_id,
  sender_username,
  receiver_id,
  receiver_username,
  body,
  content_type,
  media_url,
  r2_key,
  client_id,
  quote,
  deleted_at,
  created_at
)
select
  m.id,
  m.conversation_id,
  m.sender_id,
  coalesce(m.sender_username, 'Kullanıcı'),
  m.receiver_id,
  m.receiver_username,
  coalesce(m.body, ''),
  coalesce(m.content_type, 'text'::public.message_content_type),
  m.media_url,
  m.r2_key,
  m.client_id,
  m.quote,
  m.deleted_at,
  m.created_at
from public.messages m;

alter table public.message_reactions
  drop constraint if exists message_reactions_message_id_fkey;

drop trigger if exists messages_set_parties on public.messages;
drop trigger if exists messages_set_sender_username on public.messages;
drop trigger if exists trg_messages_queue_r2 on public.messages;

drop table public.messages;

alter table public.messages_ordered rename to messages;

alter table public.message_reactions
  add constraint message_reactions_message_id_fkey
  foreign key (message_id) references public.messages(id) on delete cascade;

create index if not exists messages_conv_created_idx
  on public.messages (conversation_id, created_at);

create index if not exists messages_created_at_idx
  on public.messages (created_at);

create index if not exists messages_client_id_idx
  on public.messages (client_id)
  where client_id is not null;

create index if not exists messages_deleted_at_idx
  on public.messages (deleted_at)
  where deleted_at is not null;

create extension if not exists pg_trgm;

create index if not exists messages_body_trgm_idx
  on public.messages using gin (body gin_trgm_ops)
  where deleted_at is null;

drop trigger if exists messages_set_parties on public.messages;
create trigger messages_set_parties
  before insert on public.messages
  for each row
  execute function public.set_message_parties();

drop trigger if exists trg_messages_queue_r2 on public.messages;
create trigger trg_messages_queue_r2
  before delete on public.messages
  for each row
  execute function public.queue_r2_key_on_message_delete();

alter table public.messages enable row level security;

drop policy if exists "messages: read dm if member" on public.messages;
create policy "messages: read dm if member"
on public.messages for select to authenticated
using (
  deleted_at is null
  and public.is_dm_participant(conversation_id)
);

drop policy if exists "messages: read group if matches district" on public.messages;
create policy "messages: read group if matches district"
on public.messages for select to authenticated
using (
  deleted_at is null
  and public.is_group_conversation_for_user(conversation_id)
);

drop policy if exists "messages: anon read group" on public.messages;
create policy "messages: anon read group"
on public.messages for select to anon
using (
  deleted_at is null
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.type = 'group'
  )
);

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

grant select, insert on public.messages to authenticated;
grant select on public.messages to anon;
