import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { recordEvent } from '@/lib/memory/events';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { translate } from '@/lib/i18n/messages';
import { getMarketScope, recordMarketScope, isMarketScope } from '@/lib/market-scope';

/**
 * POST /api/projects/{projectId}/market-scope   { scope: 'IT' | 'EU' | 'INTL' }
 *
 * Records the founder's call on the addressable market before any TAM/SAM/SOM
 * work (changelog 05/09 item 7d). The click IS the decision, so it lands here
 * directly rather than round-tripping a chat message the model would narrate
 * and might mis-record — same contract as /gate-verdict.
 *
 * On success it stages the follow-up in chat: a confirmation plus one option to
 * run the sizing at the scope just chosen. That last step is why the answer is
 * worth a click — otherwise the founder answers a question and is left looking
 * at the same screen.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const scope = (body as { scope?: unknown })?.scope;
  if (!isMarketScope(scope)) return error('scope must be one of IT, EU, INTL');

  const record = await recordMarketScope(projectId, scope);

  const proj = await query<{ owner_user_id: string | null }>(
    'SELECT owner_user_id FROM projects WHERE id = ?', projectId,
  ).catch(() => [] as { owner_user_id: string | null }[]);
  const ownerUserId = auth.session.userId || proj[0]?.owner_user_id || '';

  // Non-fatal: the scope is already recorded, which is the part that matters.
  // A failure to stage the follow-up must not read as a failure to answer.
  let staged = false;
  if (ownerUserId) {
    try {
      const locale = await resolveLocale(ownerUserId, projectId);
      const content = `:::artifact{"type":"option-set","id":"opt_market_scope_done_${projectId.slice(-8)}"}\n`
        + JSON.stringify({
            prompt: translate(locale, `market-scope.recorded-${scope}`),
            options: [{
              id: 'market_scope_run_sizing',
              label: translate(locale, 'market-scope.run-now'),
              description: translate(locale, 'market-scope.run-now-desc'),
              skill_id: 'market-research',
            }],
          })
        + '\n:::';
      await run(
        `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
         VALUES (?, ?, 'chat', 'assistant', ?, ?, ?)`,
        generateId('msg'), projectId, content, new Date().toISOString(), ownerUserId,
      );
      await recordEvent({
        userId: ownerUserId, projectId, eventType: 'market_scope_recorded', payload: { scope },
      });
      staged = true;
    } catch (err) {
      console.warn('[market-scope] follow-up staging failed (non-fatal):', (err as Error).message);
    }
  }

  return json({ market_scope: record, followup_staged: staged });
}

/** GET — the recorded scope, or null when the founder has not answered yet. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  // getMarketScope throws rather than swallowing (see its note), so a database
  // without 047 must degrade to "not answered" here instead of a 500.
  const scope = await getMarketScope(projectId).catch(() => null);
  return json({ market_scope: scope });
}
