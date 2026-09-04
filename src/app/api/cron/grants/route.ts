import { NextRequest } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { syncFundingCalls } from '@/lib/grants/sync';
import type { SyncResult } from '@/lib/grants/types';

/**
 * GET /api/cron/grants  (CRON_SECRET bearer) — the daily grants tracking sync.
 *
 * MANUAL / LOCAL USE ONLY — this endpoint CANNOT finish on Netlify.
 *
 * A full three-source sync takes 75-81s. This route was written believing that
 * a consumed stream keeps a Netlify function alive past the ~26s synchronous
 * limit, the way a comment in run-monitor claims. That is FALSE, and it was
 * measured on prod 2026-09-02: heartbeats arrived to 30s, then the connection
 * died with no done frame and nothing synced.
 *
 * The daily sync therefore runs as a Netlify BACKGROUND function
 * (netlify/functions/grants-sync-background.mts, 15-minute budget), which the
 * GitHub Actions scheduler POSTs to. This route is kept because it is genuinely
 * useful off-platform: run it against a local dev server to watch a forced sync
 * progress frame by frame. Do not wire it into the scheduler again.
 *
 * maxDuration below is honored on Vercel only.
 */
export const maxDuration = 300;
const HEARTBEAT_MS = 5_000;

function flat(r: SyncResult) {
  const ran = r.sources.filter((s) => !s.skipped_gate);
  return {
    ok: !r.error && ran.every((s) => s.ok),
    sources_ran: ran.length,
    fetched: ran.reduce((n, s) => n + s.fetched, 0),
    inserted: ran.reduce((n, s) => n + s.inserted, 0),
    alerts: ran.reduce((n, s) => n + s.alerts_created, 0),
    expired: r.expired,
    errors: [r.error, ...ran.filter((s) => s.error).map((s) => `${s.source}: ${s.error}`)].filter(Boolean).join('; ') || null,
  };
}

export async function GET(request: NextRequest) {
  const auth = requireCronAuth(request);
  if (!auth.ok) return auth.response;

  // ?force=1 bypasses the once-per-day gate — for a manual re-run after a
  // failed tick or to prove the full-length stream survives the platform.
  const force = request.nextUrl.searchParams.get('force') === '1';
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* consumer gone */ }
      };
      send({ started: true, at: new Date(startedAt).toISOString(), force });
      const hb = setInterval(() => send({ heartbeat_s: Math.round((Date.now() - startedAt) / 1000) }), HEARTBEAT_MS);
      syncFundingCalls({ now: new Date(), force })
        .then((r) => {
          send({ result: r });
          send({ done: true, ms: Date.now() - startedAt, ...flat(r) });
        })
        .catch((err) => {
          console.error('[grants][cron] sync failed:', err);
          send({ done: true, ms: Date.now() - startedAt, ok: false, errors: (err as Error).message });
        })
        .finally(() => {
          clearInterval(hb);
          try { controller.close(); } catch { /* already closed */ }
        });
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
