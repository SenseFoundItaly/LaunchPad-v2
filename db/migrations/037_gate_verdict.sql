-- 037 — Validation Gate verdict (founder GO / NO-GO)
--
-- Founder request 2026-08-04: the Validation Gate ends with an explicit
-- go/no-go, not just an evidence tally. This is the founder's ATTESTATION, so
-- it must be structured and auditable — not a keyword-matched memory_fact.
--
-- Shape:  {"verdict": "GO" | "NO_GO", "decided_at": "<iso>", "motivation": "<text>"}
--
-- Read by the Stage-2 `gate_verdict` check via the project snapshot
-- (`SELECT * FROM research`), stamped by applyValidationProposal on Apply —
-- the same founder-approval discipline as research.market_size.approved.
--
-- Safe to run against a DB that already has the column (IF NOT EXISTS), and
-- safe to NOT run: the snapshot selects * and the check simply reads undefined
-- → the gate stays open rather than erroring.
--
-- NOTE on numbering: 035 belongs to PR #225 (applied to prod, not yet merged —
-- see #337) and 036 is the scores heal. 037 is the next free number and does
-- not collide with either.

ALTER TABLE research ADD COLUMN IF NOT EXISTS gate_verdict JSONB;

COMMENT ON COLUMN research.gate_verdict IS
  'Founder GO/NO-GO on the Validation Gate. {verdict, decided_at, motivation}. Written only on explicit founder approval.';
