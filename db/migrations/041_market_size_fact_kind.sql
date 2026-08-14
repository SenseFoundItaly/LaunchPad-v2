-- 041 — the 13 apply-path market-size facts 040 could not see.
--
-- 040 re-kinded approved evidence by anchored prefix, guarded on
-- kind = 'observation' because that is what the shared apply branch wrote.
-- The market_size_fact branch is older and writes kind = 'fact'
-- (action-executors.ts), so all 13 prod rows were skipped: they kept greening
-- `market_size` through the legacy keyword branch and were mislabelled "from
-- something you said in chat" when the founder had in fact approved them.
--
-- Fixed forward in the same commit; this backfills. Guarded on the two exact
-- prefixes the executor emits (avs.prefix-market-size, EN + IT) so it cannot
-- catch a founder's free-text sizing note.
--
-- Idempotent: re-running matches the same rows and rewrites the same value.

UPDATE memory_facts SET kind = 'market_size_fact'
 WHERE kind = 'fact'
   AND (fact LIKE 'Market size — %' OR fact LIKE 'Dimensione del mercato — %');
