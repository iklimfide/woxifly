-- R2 public URL'lerinde bucket öneki (/woxifly/uploads/...) için ek güvenlik ağı.
-- Asıl düzeltme istemci tarafında proxy yolu kaydıdır; bu SQL opsiyoneldir.

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
        or media_url ~ '^https://[^/]+/[^/]+/uploads/[a-zA-Z0-9._%-/]+$'
      )
    )
  );
