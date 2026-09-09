-- 047 — Addressable market scope (founder's strategic call)
--
-- Changelog 05/09 item 7d: "Prima della ricerca TAM SAM SOM, chatbot dovrebbe
-- chiedermi se vogliamo considerare un mercato 'addressable' italiano, europeo
-- o internazionale, in base alle prospettive strategiche del founder."
--
-- Without this the sizing run picks a geography on its own, and a global TAM
-- lands on a founder who will only ever sell in Italy — a number that reads as
-- ambition and plans as fiction. It is the founder's STRATEGY, so it is stored
-- structurally rather than keyword-matched out of a memory_fact.
--
-- Shape:  {"scope": "IT" | "EU" | "INTL", "decided_at": "<iso>"}
--
-- Read via the project snapshot (`SELECT * FROM research`) and injected into
-- every skill run's context by buildSkillProjectContext.
--
-- Safe to run twice (IF NOT EXISTS), and safe to NOT run: the snapshot selects
-- * and every reader treats a missing column as "not asked yet", which is the
-- pre-migration behaviour.

ALTER TABLE research ADD COLUMN IF NOT EXISTS market_scope JSONB;

COMMENT ON COLUMN research.market_scope IS
  'Founder call on the addressable market before TAM/SAM/SOM. {scope: IT|EU|INTL, decided_at}. Written only on an explicit founder choice.';
