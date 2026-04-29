/**
 * Firecrawl API client with Jina fallback for URL-based change detection.
 *
 * When FIRECRAWL_API_KEY is set:
 *   - Calls POST https://api.firecrawl.dev/v1/scrape with changeTracking
 *   - Returns native diff + changeStatus from Firecrawl
 *
 * When FIRECRAWL_API_KEY is NOT set (fallback mode):
 *   - Fetches markdown via r.jina.ai/{url}
 *   - Computes SHA256 hash of the content
 *   - Compares to previous hash stored in watch_sources.last_content_hash
 *   - No native diff; the LLM compares old vs new during classification
 */

import { createHash } from 'crypto';
import type { ChangeStatus } from '@/types';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev';
const JINA_API_KEY = process.env.JINA_API_KEY || '';

const MIN_INTERVAL_MS = 600; // rate limiter: 600ms between calls
let lastCallAt = 0;

export interface ScrapeResult {
  markdown: string;
  contentHash: string;
  changeStatus: ChangeStatus;
  rawDiff: string | null;
  previousScrapeAt: string | null;
  /** Which scraping backend was used */
  backend: 'firecrawl' | 'jina';
}

export interface ScrapeConfig {
  /** Firecrawl change tracking tag (stored per watch source) */
  changeTrackingTag?: string;
  /** Previous content hash for Jina fallback comparison */
  previousContentHash?: string | null;
  /** Whether this is the first scrape (no previous snapshot) */
  isFirstScrape?: boolean;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastCallAt = Date.now();
}

// ---------------------------------------------------------------------------
// Firecrawl scraping (primary — when API key is set)
// ---------------------------------------------------------------------------

async function scrapeWithFirecrawl(
  url: string,
  config: ScrapeConfig,
): Promise<ScrapeResult> {
  await rateLimitWait();

  const body: Record<string, unknown> = {
    url,
    formats: ['markdown'],
    changeTracking: {
      mode: 'git-diff',
      ...(config.changeTrackingTag ? { tag: config.changeTrackingTag } : {}),
    },
  };

  const res = await fetch(`${FIRECRAWL_API_URL}/v1/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firecrawl HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json() as {
    success?: boolean;
    data?: {
      markdown?: string;
      changeTracking?: {
        changeStatus?: string;
        diff?: string;
        previousScrapeAt?: string;
      };
    };
  };

  const markdown = json.data?.markdown || '';
  const ct = json.data?.changeTracking;

  return {
    markdown,
    contentHash: sha256(markdown),
    changeStatus: (ct?.changeStatus as ChangeStatus) || (config.isFirstScrape ? 'new' : 'same'),
    rawDiff: ct?.diff || null,
    previousScrapeAt: ct?.previousScrapeAt || null,
    backend: 'firecrawl',
  };
}

// ---------------------------------------------------------------------------
// Jina fallback (no Firecrawl key — hash-based change detection)
// ---------------------------------------------------------------------------

async function scrapeWithJina(
  url: string,
  config: ScrapeConfig,
): Promise<ScrapeResult> {
  await rateLimitWait();

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (JINA_API_KEY) {
    headers.Authorization = `Bearer ${JINA_API_KEY}`;
  }

  const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`Jina read HTTP ${res.status}`);
  }

  const ct = res.headers.get('content-type') || '';
  let markdown: string;
  if (ct.includes('json')) {
    const json = await res.json() as { data?: { content?: string } };
    markdown = json.data?.content ?? '';
  } else {
    markdown = await res.text();
  }

  const contentHash = sha256(markdown);
  let changeStatus: ChangeStatus;

  if (config.isFirstScrape || !config.previousContentHash) {
    changeStatus = 'new';
  } else if (contentHash === config.previousContentHash) {
    changeStatus = 'same';
  } else {
    changeStatus = 'changed';
  }

  return {
    markdown,
    contentHash,
    changeStatus,
    rawDiff: null, // no native diff from Jina
    previousScrapeAt: null,
    backend: 'jina',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scrape a URL with change tracking. Uses Firecrawl when available,
 * falls back to Jina + SHA256 hash comparison.
 *
 * On failure, returns changeStatus: 'same' so the caller doesn't create
 * spurious change records.
 */
export async function scrapeWithChangeTracking(
  url: string,
  config: ScrapeConfig = {},
): Promise<ScrapeResult> {
  try {
    if (FIRECRAWL_API_KEY) {
      return await scrapeWithFirecrawl(url, config);
    }
    return await scrapeWithJina(url, config);
  } catch (err) {
    console.warn(`[firecrawl] scrape failed for ${url}:`, (err as Error).message);
    // Non-fatal: return 'same' so we don't create false change records
    return {
      markdown: '',
      contentHash: config.previousContentHash || '',
      changeStatus: 'same',
      rawDiff: null,
      previousScrapeAt: null,
      backend: FIRECRAWL_API_KEY ? 'firecrawl' : 'jina',
    };
  }
}

/** Returns whether Firecrawl is configured (for UI hints) */
export function isFirecrawlConfigured(): boolean {
  return Boolean(FIRECRAWL_API_KEY);
}
