-- One pending_action per ecosystem_alert (audit #158).
--
-- materializeProposalsFromSources did a check-then-insert (NOT EXISTS → INSERT)
-- with no unique constraint, so two concurrent inbox reads both passed the
-- check and both inserted → a signal double-surfaced and left a permanent
-- phantom 'pending' that inflated the NavRail badge forever. This dedups the
-- existing dupes, then enforces uniqueness so INSERT ... ON CONFLICT can make
-- materialization idempotent.

-- 1. Collapse existing duplicates, keeping ONE row per alert: prefer a row that
--    was already actioned (status not pending/edited) so an accepted signal is
--    never dropped, else the earliest-created row.
DELETE FROM pending_actions pa
 USING (
   SELECT id,
          row_number() OVER (
            PARTITION BY ecosystem_alert_id
            ORDER BY (status IN ('pending', 'edited')) ASC, created_at ASC
          ) AS rn
     FROM pending_actions
    WHERE ecosystem_alert_id IS NOT NULL
 ) dup
 WHERE pa.id = dup.id
   AND dup.rn > 1;

-- 2. Enforce it going forward (partial: only rows that reference an alert).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_actions_ecosystem_alert
  ON pending_actions (ecosystem_alert_id)
  WHERE ecosystem_alert_id IS NOT NULL;
