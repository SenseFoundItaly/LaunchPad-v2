-- =============================================================================
-- 006 — pgvector + hybrid retrieval support
--
-- Adds vector embeddings + BM25 full-text indexes to memory_facts and
-- graph_nodes so the agent can search the brain by relevance instead of
-- recency. See src/lib/memory/retrieve.ts for the consumer.
--
-- BYTEA `embedding` columns from a prior, abandoned attempt are dropped
-- here. If any rows have data in them (they shouldn't — the column was
-- never populated), the data will be lost. Verify with:
--   SELECT COUNT(*) FROM memory_facts WHERE embedding IS NOT NULL;
-- before running on production.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ── memory_facts ───────────────────────────────────────────────────────────
ALTER TABLE memory_facts DROP COLUMN IF EXISTS embedding;
ALTER TABLE memory_facts ADD COLUMN embedding vector(1536);
ALTER TABLE memory_facts ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE memory_facts ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMP;

-- HNSW index for cosine-distance ANN search. m=16, ef_construction=64 are
-- the pgvector defaults — good balance of build speed and recall for
-- collections under ~1M vectors. ef_search defaults to 40 at query time;
-- set higher per-query if recall on small projects matters more than
-- latency.
CREATE INDEX IF NOT EXISTS idx_memory_facts_embedding_hnsw
  ON memory_facts USING hnsw (embedding vector_cosine_ops);

-- BM25 / tsvector for keyword ranking. Generated column keeps it in sync
-- with `fact` without trigger maintenance. GIN index makes ts_rank queries
-- sub-millisecond.
ALTER TABLE memory_facts
  ADD COLUMN IF NOT EXISTS fact_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(fact, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_memory_facts_tsv
  ON memory_facts USING gin (fact_tsv);

-- ── graph_nodes ────────────────────────────────────────────────────────────
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_graph_nodes_embedding_hnsw
  ON graph_nodes USING hnsw (embedding vector_cosine_ops);

ALTER TABLE graph_nodes
  ADD COLUMN IF NOT EXISTS node_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(name, '') || ' ' || coalesce(summary, '')
    )
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_graph_nodes_tsv
  ON graph_nodes USING gin (node_tsv);

-- Also keep schema.sql in sync — this migration is the source of truth
-- going forward; schema.sql gets the same columns at next edit.
