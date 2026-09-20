-- Run as the Supabase project owner after storing PROCUREMENT_WORKER_SECRET
-- in Vercel and the matching value in Vault as procurement_worker_secret.
-- This file deliberately contains no credentials.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='procurement_worker_secret') THEN
    RAISE EXCEPTION 'Store procurement_worker_secret in Vault before enabling the worker';
  END IF;
END $$;

SELECT cron.schedule(
  'procurement-inbox-worker',
  '* * * * *',
  $job$
    SELECT net.http_post(
      url := 'https://bliss-birch-procurement.vercel.app/internal/process-inbox',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name='procurement_worker_secret' LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    )
    WHERE EXISTS (
      SELECT 1 FROM procurement.webhook_inbox
      WHERE status='PENDING'
         OR (status='ERROR' AND
             (processed_at IS NULL OR processed_at::timestamptz < now()-interval '5 minutes'))
    );
  $job$
);
