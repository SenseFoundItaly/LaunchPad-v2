/**
 * In-memory token-bucket rate limiter.
 *
 * Each key (e.g. `chat:<userId>`) gets a bucket with `maxTokens` capacity
 * that refills at `refillPerSecond`. A request consumes one token; when the
 * bucket is empty the request is rejected.
 *
 * Stale buckets are cleaned up every 5 minutes to prevent unbounded Map growth.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 minutes unused

let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > STALE_THRESHOLD_MS) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * Check (and consume) a rate limit token for the given key.
 *
 * @param key            Unique identifier, e.g. `chat:user-abc`
 * @param maxTokens      Bucket capacity (burst size)
 * @param refillPerSecond How many tokens are added per second
 */
export function checkRateLimit(
  key: string,
  maxTokens: number,
  refillPerSecond: number,
): RateLimitResult {
  cleanup();

  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: now };
    buckets.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillPerSecond);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true };
  }

  // Calculate how long until one token is available
  const deficit = 1 - bucket.tokens;
  const retryAfterSeconds = Math.ceil(deficit / refillPerSecond);
  return { allowed: false, retryAfterSeconds };
}
