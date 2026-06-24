-- messages.id için otomatik UUID (migration swap sonrası eksik kalmış olabilir)
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

alter table public.messages
  alter column id set default gen_random_uuid();
