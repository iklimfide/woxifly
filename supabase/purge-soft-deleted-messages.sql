-- Soft delete edilmiş mesajları kalıcı sil (deleted_at IS NOT NULL)
-- deleted_at IS NULL olanlar kalır.
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

-- Önce kaç kayıt silinecek (opsiyonel önizleme)
select count(*) as silinecek_mesaj_sayisi
from public.messages
where deleted_at is not null
  and deleted_at <= now();

-- Kalıcı silme (message_reactions cascade; R2 kuyruğu delete trigger ile)
delete from public.messages
where deleted_at is not null
  and deleted_at <= now();

-- Kalan soft-delete bekleyen kayıt olmamalı
select count(*) as kalan_soft_deleted
from public.messages
where deleted_at is not null;
