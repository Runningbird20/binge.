-- Run once (Supabase SQL editor) to deliver "Remind me" notifications on
-- time. Vercel Hobby crons only run daily, so Supabase calls the endpoint
-- every 10 minutes instead. Replace the two placeholders first:
--   <SITE>        your production URL, e.g. https://binge.vercel.app
--   <CRON_SECRET> the same CRON_SECRET set in Vercel
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('binge-reminders') where exists (select 1 from cron.job where jobname = 'binge-reminders');
select cron.schedule(
  'binge-reminders',
  '*/10 * * * *',
  $$ select net.http_get(
       url := '<SITE>/api/cron/reminders',
       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
     ); $$
);
