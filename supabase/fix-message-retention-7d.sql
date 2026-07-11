-- 7 günlük mesaj imhası: sohbet aktif olsa bile created_at > 7 gün olan mesajlar silinir.
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.
-- pg_cron extension etkin olmalı.

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
  $$
    delete from public.messages
    where created_at < now() - interval '7 days'
       or (deleted_at is not null and deleted_at < now() - interval '7 days');
  $$
);

comment on column public.messages.created_at is
  'Mesaj oluşturulma zamanı; 7 günden eski kayıtlar pg_cron ile kalıcı silinir (sohbet aktifliğinden bağımsız).';
