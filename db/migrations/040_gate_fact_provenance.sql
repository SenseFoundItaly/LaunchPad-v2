-- 040 — carry the approved family on memory_facts.kind, and stop counting
-- agent-authored breadcrumbs as founder evidence.
--
-- Context (measured on prod 2026-08-14): 18 of 103 gate greens were false.
-- The apply path wrote every one of the 13 approved item kinds as
-- kind='observation' and re-encoded the family as a localized TEXT PREFIX, so
-- each check re-derived the meaning by keyword over the whole fact corpus.
-- Consequence: a fact approved as GTM evidence whose prose mentioned partners
-- also greened partners_identified; an approved IP finding greened
-- build_approach and regulatory_check. One project had 3 approved facts
-- greening 6 checks.
--
-- Part A re-kinds the existing apply-path facts by their EXACT emitted prefix,
-- so the ownership rule in journey/snapshot.ts has provenance to read on
-- historical data. Anchored LIKE only — never a loose contains, which is the
-- mistake being undone here.
--
-- Part B re-sources the agent workflow breadcrumbs. workflow-capture.ts has
-- written source_type='workflow' since 2026-07-11 and the snapshot excludes
-- that value, but the 48 rows written 2026-05-11 → 06-22 carry 'chat' and
-- sailed through, greening gtm_opportunities on 5 projects and build_approach
-- on 1 off text like `Agent proposed workflow "90-Day GTM Plan"`.
--
-- Additive and idempotent: re-running matches the same rows and rewrites the
-- same values. Facts with no matching prefix are left alone — they keep
-- greening their check via the legacy keyword branch, so no founder loses work.

-- ── Part A: prefix → family kind ────────────────────────────────────────────
UPDATE memory_facts SET kind = 'market_size_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Market size — %' OR fact LIKE 'Dimensione del mercato — %');

UPDATE memory_facts SET kind = 'differentiation_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Differentiator — %' OR fact LIKE 'Differenziazione — %');

UPDATE memory_facts SET kind = 'trend_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Market trend — %' OR fact LIKE 'Trend di mercato — %');

UPDATE memory_facts SET kind = 'buyer_persona_fact'
 WHERE kind = 'observation' AND fact LIKE 'Buyer persona — %';

UPDATE memory_facts SET kind = 'gtm_fact'
 WHERE kind = 'observation' AND (fact LIKE 'GTM opportunity — %' OR fact LIKE 'Opportunità GTM — %');

UPDATE memory_facts SET kind = 'partner_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Potential partner — %' OR fact LIKE 'Partner potenziale — %');

UPDATE memory_facts SET kind = 'ip_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Intellectual property — %' OR fact LIKE 'Proprietà intellettuale — %');

UPDATE memory_facts SET kind = 'data_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Data availability — %' OR fact LIKE 'Disponibilità dei dati — %');

UPDATE memory_facts SET kind = 'validation_strategy_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Validation strategy — %' OR fact LIKE 'Strategia di validazione — %');

UPDATE memory_facts SET kind = 'jtbd_fact'
 WHERE kind = 'observation' AND fact LIKE 'Jobs to be done — %';

-- The EN branch emitted the ITALIAN prefix for these two until 2026-08-14
-- (action-executors.ts), so both spellings are real prod data.
UPDATE memory_facts SET kind = 'cogs_opex_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Fixed cost and variable cost — %' OR fact LIKE 'Costi fissi e variabili — %');

UPDATE memory_facts SET kind = 'revenue_stream_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Revenue stream — %' OR fact LIKE 'Flusso di ricavo — %');

UPDATE memory_facts SET kind = 'persona_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Ideal customer profile — %' OR fact LIKE 'Profilo del cliente ideale — %');

UPDATE memory_facts SET kind = 'channel_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Acquisition channel — %' OR fact LIKE 'Canale di acquisizione — %');

UPDATE memory_facts SET kind = 'tech_feasibility_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Feasibility — %' OR fact LIKE 'Fattibilità tecnica — %');

UPDATE memory_facts SET kind = 'tech_risk_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Technical risk — %' OR fact LIKE 'Rischio tecnico — %');

UPDATE memory_facts SET kind = 'tech_dependency_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Key dependency — %' OR fact LIKE 'Dipendenza chiave — %');

UPDATE memory_facts SET kind = 'regulatory_fact'
 WHERE kind = 'observation' AND (fact LIKE 'Regulatory — %' OR fact LIKE 'Normativa — %');

-- ── Part B: agent breadcrumbs are not founder evidence ──────────────────────
UPDATE memory_facts
   SET source_type = 'workflow'
 WHERE fact LIKE 'Agent proposed workflow%'
   AND source_type IS DISTINCT FROM 'workflow';
