-- R2 medya klasörleri: images/, videos/, audio/, avatars/ (+ eski uploads/)
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

alter table public.messages
  drop constraint if exists messages_media_url_path_chk;

alter table public.messages
  add constraint messages_media_url_path_chk
  check (
    media_url is null
    or (
      char_length(media_url) between 10 and 2048
      and (
        media_url ~ '^/api/media/(?:images|videos|audio|avatars|uploads)/[a-zA-Z0-9._%-/]+$'
        or media_url ~ '^https://[^/]+/(?:images|videos|audio|avatars|uploads)/[a-zA-Z0-9._%-/]+$'
        or media_url ~ '^https://[^/]+/[^/]+/(?:images|videos|audio|avatars|uploads)/[a-zA-Z0-9._%-/]+$'
      )
    )
  );
