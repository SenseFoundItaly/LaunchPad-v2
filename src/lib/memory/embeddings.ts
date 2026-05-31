/**
 * Embedding service — wraps OpenAI text-embedding-3-small (1536 dims).
 *
 * Used by:
 *   - recordFact (in facts.ts) on fact_applied transition
 *   - graph node writers (action-executors.ts + artifact-persistence.ts)
 *   - scripts/backfill-embeddings.ts for one-shot historical embedding
 *   - retrieve.ts to embed the query at search time
 *
 * Provider choice: OpenAI is already in package.json and .env.example, the
 * 1536-dim default matches the migration's `vector(1536)` column, and the
 * cost is rounding error (~$0.02 / 1M tokens). Swapping to Voyage or
 * Cohere would only require changing the EMBEDDING_MODEL constant and the
 * client class — call sites stay the same.
 *
 * Failure mode: all callers should treat embed() failures as non-fatal.
 * Returning null means the row stays unembedded; retrieval falls back to
 * BM25 + recency for that row until backfill runs.
 */
import OpenAI from 'openai';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return cachedClient;
}

/**
 * Convert a number[] embedding to the pgvector wire format.
 * postgres.js doesn't have a native vector type binding, so we pass the
 * literal text form: '[0.1,0.2,...]'. The Postgres parser accepts this.
 */
export function toPgVector(emb: number[]): string {
  return `[${emb.join(',')}]`;
}

/**
 * Embed a single string. Returns null on missing API key, empty input, or
 * provider error. Callers MUST treat null as "skip the embedding, move on."
 */
export async function embed(text: string): Promise<number[] | null> {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const client = getClient();
  if (!client) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[embeddings] OPENAI_API_KEY missing — skipping embed()');
    }
    return null;
  }

  try {
    const resp = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: trimmed,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    const vec = resp.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMENSIONS) {
      console.warn(`[embeddings] unexpected response shape from ${EMBEDDING_MODEL}`);
      return null;
    }
    return vec;
  } catch (err) {
    console.warn('[embeddings] embed() failed:', (err as Error).message);
    return null;
  }
}

/**
 * Embed many strings in a single API round-trip. OpenAI's embeddings
 * endpoint accepts up to 2048 inputs per call; we cap conservatively at
 * 100 so token totals stay manageable. Returns a parallel array — entries
 * are null where embedding failed (preserving index alignment with input).
 */
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];

  const client = getClient();
  if (!client) return texts.map(() => null);

  const trimmed = texts.map((t) => (t ?? '').trim());
  const out: (number[] | null)[] = new Array(trimmed.length).fill(null);

  // OpenAI rejects empty strings; skip those and align outputs by index.
  const indices: number[] = [];
  const inputs: string[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i].length > 0) {
      indices.push(i);
      inputs.push(trimmed[i]);
    }
  }
  if (inputs.length === 0) return out;

  const CHUNK = 100;
  for (let start = 0; start < inputs.length; start += CHUNK) {
    const slice = inputs.slice(start, start + CHUNK);
    try {
      const resp = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: slice,
        dimensions: EMBEDDING_DIMENSIONS,
      });
      for (let j = 0; j < slice.length; j++) {
        const vec = resp.data?.[j]?.embedding;
        if (Array.isArray(vec) && vec.length === EMBEDDING_DIMENSIONS) {
          out[indices[start + j]] = vec;
        }
      }
    } catch (err) {
      console.warn('[embeddings] embedBatch chunk failed:', (err as Error).message);
      // Leave nulls in place — caller continues with what succeeded.
    }
  }

  return out;
}
