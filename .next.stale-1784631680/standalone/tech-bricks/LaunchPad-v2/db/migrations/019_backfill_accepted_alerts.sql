-- ============================================================================
-- 019: backfill orphaned-pending ecosystem_alerts that were effectively accepted
-- ----------------------------------------------------------------------------
-- A pending ecosystem_alert can get stuck at reviewed_state='pending' forever
-- when it was effectively accepted via an alert-derived pending_action (e.g. a
-- proposed_hypothesis / signal_alert that carries the alert's FK) which has
-- since advanced to status 'sent' or 'applied'.
--
-- The Inbox already hides these (materialize-on-read uses
-- NOT EXISTS(pending_actions WHERE ecosystem_alert_id = ea.id)), but the
-- Intelligence panel reads ecosystem_alerts WHERE reviewed_state='pending'
-- directly, so it keeps showing them as pending with no surface to clear them.
--
-- This flips them to 'accepted' (the same terminal state the accept executor
-- writes), stamping reviewed_at + founder_action_taken to record the implicit
-- acceptance. "Not yet reviewed" for ecosystem_alerts means reviewed_state IS
-- NULL OR reviewed_state = 'pending' (see pending-actions.ts materialize query
-- and action-executors.ts accept path) — there is no 'active'/'open' state on
-- this table, so those two are the full set we match.
--
-- Idempotent / re-runnable: the WHERE clause only touches rows that are still
-- in a not-yet-reviewed state, so a second run is a no-op (already-accepted
-- rows no longer match). reviewed_at / founder_action_taken are set only on
-- the rows being transitioned.
-- ============================================================================

BEGIN;

UPDATE ecosystem_alerts ea
   SET reviewed_state = 'accepted',
       reviewed_at = CURRENT_TIMESTAMP,
       founder_action_taken = 'inbox_accept'
 WHERE (ea.reviewed_state IS NULL OR ea.reviewed_state = 'pending')
   AND EXISTS (
     SELECT 1
       FROM pending_actions pa
      WHERE pa.ecosystem_alert_id = ea.id
        AND pa.status IN ('sent', 'applied')
   );

COMMIT;
