-- Run once (Supabase SQL editor) to deliver "Remind me" notifications and
-- followed-team game alerts on time. Vercel Hobby crons only run daily, so
-- Supabase calls the endpoint every 3 minutes instead (close-game windows
-- are short). Already scheduled at */10? Just run:
--   select cron.alter_job((select jobid from cron.job where jobname = 'binge-reminders'), schedule := '*/3 * * * *');
-- Fresh setup: replace the two placeholders first:
--   <SITE>        your production URL, e.g. https://binge.vercel.app
--   <CRON_SECRET> the same CRON_SECRET set in Vercel
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('binge-reminders') where exists (select 1 from cron.job where jobname = 'binge-reminders');
select cron.schedule(
  'binge-reminders',
  '*/3 * * * *',
  $$ select net.http_get(
       url := '<SITE>/api/cron/reminders',
       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
     ); $$
);
