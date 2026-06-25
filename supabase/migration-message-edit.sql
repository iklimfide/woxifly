-- Mesaj düzenleme: edited_at + edit_message RPC
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

alter table public.messages
  add column if not exists edited_at timestamptz;

create or replace function public.edit_message(
  p_message_id uuid,
  p_body text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text;
  v_updated int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_message_id is null then
    return false;
  end if;

  v_body := trim(coalesce(p_body, ''));
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    return false;
  end if;

  update public.messages
  set body = v_body,
      edited_at = now()
  where id = p_message_id
    and sender_id = auth.uid()
    and deleted_at is null
    and content_type = 'text';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;

comment on column public.messages.edited_at is 'Gönderen tarafından son düzenleme zamanı.';
