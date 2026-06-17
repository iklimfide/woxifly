-- Arama performansı (opsiyonel, SQL Editor'da bir kez çalıştırın)
create extension if not exists pg_trgm;

create index if not exists profiles_username_trgm_idx
  on public.profiles using gin (username gin_trgm_ops);

create index if not exists messages_body_trgm_idx
  on public.messages using gin (body gin_trgm_ops)
  where deleted_at is null;
