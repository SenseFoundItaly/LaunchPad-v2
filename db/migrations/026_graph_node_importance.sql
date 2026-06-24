-- AI "why this matters" rationale for a knowledge node, generated ONCE on first
-- view (lazy) and cached here. Read path prefers this; falls back to the
-- deterministic per-type template (node-importance.ts) when absent. Flag-gated
-- (NODE_IMPORTANCE_AI) so generation only happens when enabled — the column is
-- harmless when empty.
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS importance TEXT;
