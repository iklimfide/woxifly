-- Woxifly: 7 günlük mesaj temizliği + medya/R2 referans mimarisi
-- Supabase Dashboard > SQL Editor'da çalıştırın.
-- pg_cron için: Database > Extensions > pg_cron etkinleştirin.

-- Mesaj içerik tipi
do $$ begin
  if not exists (select 1 from pg_type where typname = 'message_content_type') then
    create type public.message_content_type as enum ('text', 'image', 'video', 'audio');
  end if;
end $$;

-- Mesaj tablosu genişletme
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

-- schema.sql inline kısıtı messages_body_check adıyla oluşur
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

create index if not exists messages_created_at_idx on public.messages (created_at);

-- Silinen mesajların R2 anahtarlarını gece temizliği için kuyruğa al
create table if not exists public.r2_deletion_queue (
  id uuid primary key default gen_random_uuid(),
  r2_key text not null unique,
  queued_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.r2_deletion_queue enable row level security;

-- Kuyruk yalnızca backend (service role) tarafından okunur; istemci erişemez
revoke all on table public.r2_deletion_queue from anon, authenticated;

create or replace function public.queue_r2_key_on_message_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.r2_key is not null and length(trim(OLD.r2_key)) > 0 then
    insert into public.r2_deletion_queue (r2_key)
    values (OLD.r2_key)
    on conflict (r2_key) do nothing;
  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_messages_queue_r2 on public.messages;
create trigger trg_messages_queue_r2
  before delete on public.messages
  for each row
  execute function public.queue_r2_key_on_message_delete();

revoke all on function public.queue_r2_key_on_message_delete() from public, anon, authenticated;

-- 7 günden eski mesajları her gece 03:00 UTC'de sil (cascade + R2 kuyruk tetiklenir)
create extension if not exists pg_cron with schema extensions;

do $woxifly$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid from cron.job where jobname = 'woxifly-purge-messages-7d'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end;
$woxifly$;

select cron.schedule(
  'woxifly-purge-messages-7d',
  '0 3 * * *',
  $$delete from public.messages where created_at < now() - interval '7 days';$$
);

-- İstatistik / izleme (opsiyonel)
comment on table public.r2_deletion_queue is
  'pg_cron ile silinen mesajlara ait R2 nesneleri; Vercel cron /api/r2-cleanup ile fiziksel silinir.';
