-- Used only by the DEV sandbox until the new checkout policy is approved.
ALTER TABLE users ADD COLUMN city_verified_at timestamptz;

-- Carry forward real successful checks, never owner/test bypasses or rejections.
UPDATE users u
SET city_verified_at = checks.verified_at
FROM (
    SELECT user_id, max(verified_at) AS verified_at
    FROM cash_location_challenges
    WHERE verified_at IS NOT NULL AND NOT dev_bypass
      AND status IN ('VERIFIED', 'USED', 'EXPIRED') AND rejection_reason = ''
    GROUP BY user_id
) checks
WHERE checks.user_id = u.id;
