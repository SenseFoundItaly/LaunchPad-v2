/**
 * URL scraping with change detection, over a fall-through provider chain:
 *
 *   1. Firecrawl (FIRECRAWL_API_KEY) — native git-diff change tracking.
 *   2. Exa contents (EXA_API_KEY) — livecrawl text + SHA256 hash comparison.
 *   3. Jina reader (JINA_API_KEY) — markdown + SHA256 hash comparison.
 *
 * WHY a chain and not a single vendor: a single provider with no balance or a
 * hard outage silently killed the entire watch-source fleet for weeks (Jina
 * HTTP 402, 2026-06). Each configured backend is tried in order; only when
 * ALL fail does the scrape report ok:false (with every provider's error).
 * Mirrors the web_search chain in pi-tools.ts.
 */

import { createHash } from 'crypto';
import type { ChangeStatus } from '@/types';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev';
const JINA_API_KEY = process.env.JINA_API_KEY || '';
const EXA_API_KEY = process.env.EXA_API_KEY || '';

const MIN_INTERVAL_MS = 600; // rate limiter: 600ms between calls
let lastCallAt = 0;

export interface ScrapeResult {
  markdown: string;
  contentHash: string;
  changeStatus: ChangeStatus;
  rawDiff: string | null;
  previousScrapeAt: string | null;
  /** Which scraping backend was used */
  backend: 'firecrawl' | 'jina' | 'exa';
  /**
   * Whether the scrape actually succeeded. `false` means the fetch failed
   * (HTTP error, timeout, no API key, etc.) and the markdown/contentHash are
   * NOT real content — callers must NOT treat this as a successful 'same'
   * scrape. Absent/true means success. This lets failures be self-describing
   * without forcing callers to wrap every call in try/catch.
   */
  ok?: boolean;
  /** Human-readable failure reason when `ok === false`. */
  error?: string;
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
    ok: true,
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

  return hashBasedResult(markdown, config, 'jina');
}

// ---------------------------------------------------------------------------
// Exa contents fallback (hash-based change detection, like Jina)
// ---------------------------------------------------------------------------

const EXA_MAX_CHARS = 60_000;

async function scrapeWithExa(
  url: string,
  config: ScrapeConfig,
): Promise<ScrapeResult> {
  await rateLimitWait();

  // livecrawl:'preferred' fetches fresh but falls back to Exa's cached index —
  // fresh enough for change watching, resilient on sites that block a live hit.
  const res = await fetch('https://api.exa.ai/contents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': EXA_API_KEY },
    body: JSON.stringify({
      urls: [url],
      text: { maxCharacters: EXA_MAX_CHARS },
      livecrawl: 'preferred',
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`Exa contents HTTP ${res.status}`);
  }

  const body = (await res.json()) as {
    results?: Array<{ text?: string }>;
  };
  const text = (body.results?.[0]?.text || '').trim();
  if (!text) {
    throw new Error('Exa contents returned empty text');
  }

  return hashBasedResult(text, config, 'exa');
}

/**
 * Build a ScrapeResult for backends without native change tracking:
 * SHA256 the content and compare against the previously stored hash.
 */
function hashBasedResult(
  content: string,
  config: ScrapeConfig,
  backend: 'jina' | 'exa',
): ScrapeResult {
  const contentHash = sha256(content);
  let changeStatus: ChangeStatus;

  if (config.isFirstScrape || !config.previousContentHash) {
    changeStatus = 'new';
  } else if (contentHash === config.previousContentHash) {
    changeStatus = 'same';
  } else {
    changeStatus = 'changed';
  }

  return {
    markdown: content,
    contentHash,
    changeStatus,
    rawDiff: null, // no native diff from hash-based backends
    previousScrapeAt: null,
    backend,
    ok: true,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let warnedNoKey = false;

/** Warn once per process if no scrape backend has a usable API key. */
function warnIfNoScrapeKey(): void {
  if (warnedNoKey) return;
  if (!FIRECRAWL_API_KEY && !JINA_API_KEY && !EXA_API_KEY) {
    warnedNoKey = true;
    console.warn(
      '[firecrawl] no scrape API key configured — URL watchers cannot fetch; ' +
        'set FIRECRAWL_API_KEY, EXA_API_KEY or JINA_API_KEY',
    );
  }
}

/**
 * Scrape a URL with change tracking, trying every CONFIGURED backend in
 * order — Firecrawl (native diff) → Exa contents → Jina reader — and falling
 * through to the next on any error. One dead provider (expired key, quota
 * 402, outage) no longer kills the fleet as long as another key works.
 *
 * On total failure this does NOT throw — instead it returns a self-describing
 * result with `ok: false` and an `error` message listing every backend's
 * failure (markdown is empty and changeStatus is 'same'). Callers MUST check
 * `ok` before treating the result as a real scrape; an empty 'same' result
 * with `ok === false` means every fetch failed, NOT that the page is
 * unchanged. This keeps failures loud at the call site while remaining
 * tolerant (no thrown exceptions to crash cron).
 */
export async function scrapeWithChangeTracking(
  url: string,
  config: ScrapeConfig = {},
): Promise<ScrapeResult> {
  warnIfNoScrapeKey();

  const chain: Array<{
    backend: ScrapeResult['backend'];
    enabled: boolean;
    scrape: () => Promise<ScrapeResult>;
  }> = [
    { backend: 'firecrawl', enabled: !!FIRECRAWL_API_KEY, scrape: () => scrapeWithFirecrawl(url, config) },
    { backend: 'exa', enabled: !!EXA_API_KEY, scrape: () => scrapeWithExa(url, config) },
    // Jina works keyless (rate-limited) too, so it stays in the chain even
    // without JINA_API_KEY — it is the terminal fallback.
    { backend: 'jina', enabled: true, scrape: () => scrapeWithJina(url, config) },
  ];

  const providerErrors: string[] = [];
  for (const link of chain) {
    if (!link.enabled) continue;
    try {
      return await link.scrape();
    } catch (err) {
      const message = (err as Error).message;
      providerErrors.push(`${link.backend}: ${message}`);
      console.warn(`[firecrawl] ${link.backend} scrape failed for ${url}:`, message);
    }
  }

  // Every configured backend failed: return a self-describing failure. We keep
  // changeStatus:'same' and empty markdown for backward-compat, but flag
  // ok:false + error so callers can detect the failure and surface it (e.g.
  // flip the watcher to status='error') instead of silently treating it as an
  // unchanged page.
  return {
    markdown: '',
    contentHash: config.previousContentHash || '',
    changeStatus: 'same',
    rawDiff: null,
    previousScrapeAt: null,
    backend: FIRECRAWL_API_KEY ? 'firecrawl' : EXA_API_KEY ? 'exa' : 'jina',
    ok: false,
    error: providerErrors.join(' | ') || 'no scrape backend configured',
  };
}

/** Returns whether Firecrawl is configured (for UI hints) */
export function isFirecrawlConfigured(): boolean {
  return Boolean(FIRECRAWL_API_KEY);
}
