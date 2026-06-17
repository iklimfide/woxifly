-- Medya mesajlarının Supabase'e kaydedilmesi için gerekli tüm düzeltmeler.
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.
--
-- Sorun: schema.sql'deki inline body kısıtı (messages_body_check) genelde
-- migration-media-cron.sql ile kaldırılmaz; boş açıklamalı medya insert'i reddedilir.

-- Mesaj içerik tipi
do $$ begin
  if not exists (select 1 from pg_type where typname = 'message_content_type') then
    create type public.message_content_type as enum ('text', 'image', 'video', 'audio');
  end if;
end $$;

-- Kolonlar
alter table public.messages
  add column if not exists content_type public.message_content_type not null default 'text';

alter table public.messages
  add column if not exists media_url text;

alter table public.messages
  add column if not exists r2_key text;

alter table public.messages
  alter column body drop not null;

alter table public.messages
  alter column body set default '';

-- Eski inline kısıt (char_length 1-2000) + migration adı
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages drop constraint if exists messages_body_chk;

alter table public.messages
  add constraint messages_body_chk
  check (char_length(body) <= 2000);

alter table public.messages
  drop constraint if exists messages_body_or_media_chk;

alter table public.messages
  add constraint messages_body_or_media_chk
  check (
    (char_length(trim(body)) >= 1)
    or (media_url is not null and char_length(media_url) between 10 and 2048)
  );

alter table public.messages
  drop constraint if exists messages_content_media_consistency_chk;

alter table public.messages
  add constraint messages_content_media_consistency_chk
  check (
    (content_type = 'text' and media_url is null)
    or (content_type <> 'text' and media_url is not null)
  );

alter table public.messages
  drop constraint if exists messages_media_url_path_chk;

alter table public.messages
  add constraint messages_media_url_path_chk
  check (
    media_url is null
    or (
      char_length(media_url) between 10 and 2048
      and (
        media_url ~ '^/api/media/uploads/[a-zA-Z0-9._%-/]+$'
        or media_url ~ '^https://[^/]+/uploads/[a-zA-Z0-9._%-/]+$'
      )
    )
  );

-- Doğrulama (sonuçta constraint adları görünmeli)
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.messages'::regclass
  and contype = 'c'
order by conname;
