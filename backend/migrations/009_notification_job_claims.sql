ALTER TABLE notification_jobs
  DROP CONSTRAINT IF EXISTS notification_jobs_status_check;

ALTER TABLE notification_jobs
  ADD CONSTRAINT notification_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'failed'));

UPDATE notification_jobs
SET status='pending',
    updated_at=now()
WHERE status='processing';

CREATE INDEX IF NOT EXISTS idx_notification_jobs_claim
  ON notification_jobs(status, next_attempt_at, updated_at);
