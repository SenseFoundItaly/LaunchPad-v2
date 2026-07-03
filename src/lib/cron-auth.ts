import type { NextRequest } from 'next/server';
import { error } from '@/lib/api-helpers';

/**
 * Cron endpoint bearer auth — shared by /api/cron and /api/cron/run-monitor.
 *
 * Policy:
 *   - CRON_SECRET unset → auth disabled in dev; 403 in production (a cron with
 *     no secret would let any public caller trigger paid LLM work).
 *   - CRON_SECRET set → every request MUST carry `Authorization: Bearer <secret>`.
 *
 * The GitHub Actions scheduler forwards the bearer from the CRON_SECRET repo
 * secret. Local: curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron
 */
export function requireCronAuth(
  request: NextRequest,
): { ok: true } | { ok: false; response: Response } {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, response: error('CRON_SECRET not configured — cron disabled in production', 403) };
    }
    return { ok: true };
  }
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (header !== `Bearer ${expected}`) {
    return { ok: false, response: error('Unauthorized cron invocation', 401) };
  }
  return { ok: true };
}
