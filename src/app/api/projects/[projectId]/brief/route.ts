import { NextRequest } from 'next/server';
import { json, error, generateId } from '@/lib/api-helpers';
import { run, get, query } from '@/lib/db';
import { AuthError } from '@/lib/auth/require-user';
import { requireProjectAccess } from '@/lib/auth/require-project-access';
import { runAgent } from '@/lib/pi-agent';
import { recordAgentUsage } from '@/lib/cost-meter';
import { buildProjectSnapshot, evaluateAllStages } from '@/lib/journey';
import { checkActionPrompt, checkGap, checkLabel } from '@/lib/journey-prompts';
import { needsPhase0Scoring } from '@/lib/direction';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { translate } from '@/lib/i18n/messages';

/**
 * POST /api/projects/{projectId}/brief
 *
 * Generates a PERSONALIZED "here's what I learned from your documents + your
 * next moves" opening message (LLM, Sonnet) and persists it as the project's
 * FIRST co-pilot turn (chat_messages), so it greets the founder when they land
 * in chat after the create-from-documents Apply.
 *
 * Idempotent: a no-op if the project already has an assistant message (so it
 * never overwrites a real conversation). The LLM cost is metered → credits
 * deducted; the create flow shows an estimate on its Apply button. The prose is
 * the LLM's; a deterministic option-set of the active stage's OPEN checks is
 * appended so the next steps are reliable, clickable, and never hallucinated.
 */

interface CanvasRow {
  problem: string | null;
  solution: string | null;
  target_market: string | null;
  value_proposition: string | null;
  business_model: string | null;
  competitive_advantage: string | null;
  channels: string | null;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  // SECURITY: gate on project access — this injects a chat message and burns
  // LLM credits against the target project, so a session check alone was an IDOR.
  let userId: string;
  try {
    ({ userId } = await requireProjectAccess(projectId));
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  // Idempotent — only brief once, before any real conversation exists.
  const existing = await get<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM chat_messages WHERE project_id = ? AND step = 'chat' AND role = 'assistant'`,
    projectId,
  );
  if (existing && existing.c > 0) {
    return json({ briefed: false, reason: 'project already has chat history' });
  }

  // Gather the state the brief reasons over.
  const snapshot = await buildProjectSnapshot(projectId);
  const evals = evaluateAllStages(snapshot);
  const canvas = await get<CanvasRow>(
    `SELECT problem, solution, target_market, value_proposition, business_model, competitive_advantage, channels
       FROM idea_canvas WHERE project_id = ?`,
    projectId,
  );
  const entities = await query<{ name: string; node_type: string | null }>(
    `SELECT name, node_type FROM graph_nodes
      WHERE project_id = ? AND node_type != 'your_startup' AND reviewed_state = 'applied'
      ORDER BY created_at DESC LIMIT 20`,
    projectId,
  );
  // Resolve locale ONCE, up front: the opening prose must be in the project
  // language (the model otherwise defaults to English on IT projects), and the
  // deterministic option-set below reuses it.
  const locale = await resolveLocale(userId, projectId);

  const active = evals.find((e) => e.status === 'active');
  const doneStages = evals.filter((e) => e.status === 'done');
  // Locked checks (1C before 1A+1B complete) are excluded — a locked check
  // must not become a clickable "help me with X" option the gate then refuses.
  const openChecks = active ? active.results.filter((r) => !r.result.passed && !r.result.locked) : [];

  const canvasLines = canvas
    ? ([
        ['Problem', canvas.problem],
        ['Solution', canvas.solution],
        ['Target market', canvas.target_market],
        ['Value proposition', canvas.value_proposition],
        ['Business model', canvas.business_model],
        ['Competitive edge', canvas.competitive_advantage],
        ['Channels', canvas.channels],
      ] as const)
        .filter(([, v]) => v && v.trim())
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n')
    : '';

  const ctx = [
    canvasLines ? `IDEA CANVAS:\n${canvasLines}` : 'IDEA CANVAS: (empty)',
    entities.length > 0
      ? `KNOWLEDGE ENTITIES: ${entities.map((e) => `${e.name} (${e.node_type})`).join(', ')}`
      : 'KNOWLEDGE ENTITIES: none',
    `VALIDATION: ${doneStages.length} stage(s) validated. Active: ${active ? `${active.stage.label} (${active.passed}/${active.total} checks)` : 'none'}.`,
    openChecks.length > 0 ? `OPEN CHECKS in the active stage: ${openChecks.map((r) => r.check.label).join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const prompt = `You are the founder's startup co-pilot. They just uploaded documents about their startup and you extracted the knowledge below. Write a SHORT, warm opening message (max 160 words, first person "I") that:
1. Acknowledges in ONE line what you learned — reference THEIR actual idea (not generic).
2. States where they stand: which validation stages are done and which is active.
3. Recommends the 2-3 most important next moves, tailored to THEIR specific idea and the open checks — name their segment/competitors/market where relevant.
Keep it conversational — no markdown headers, minimal bullets. Do NOT invent facts beyond the context. Do NOT emit any artifact blocks; just the prose.${locale === 'it' ? '\n\nWrite the ENTIRE message in Italian.' : ''}

CONTEXT:
${ctx}`;

  let prose = '';
  const startedAt = Date.now();
  try {
    const { text, usage } = await runAgent(prompt, { task: 'chat', tools: false, timeout: 40_000 });
    prose = (text || '').trim();
    // Meter the LLM cost. Awaited so the llm_usage_logs row + Langfuse flush
    // land before the serverless response returns and the Lambda freezes.
    await recordAgentUsage({
      project_id: projectId,
      step: 'project-brief',
      task: 'chat',
      usage,
      latency_ms: Date.now() - startedAt,
    });
  } catch (e) {
    return error(`Brief generation failed: ${(e as Error).message}`, 500);
  }
  if (!prose) return json({ briefed: false, reason: 'empty generation' });

  // Append a DETERMINISTIC option-set of the open checks — clickable, reliable
  // next steps (the prose is the LLM's; the actions are code, so never wrong).
  let content = prose;
  // L2 Phase 0 — canvas core landed (create-from-documents apply) but no
  // baseline score yet: the first option is a one-click scoring run (skill_id
  // → the click runs it), same condition as the direction-engine override.
  const scoringFirst = await needsPhase0Scoring(projectId);
  if (openChecks.length > 0 || scoringFirst) {
    const t = (k: Parameters<typeof translate>[1], v?: Parameters<typeof translate>[2]) => translate(locale, k, v);
    let options: Array<Record<string, unknown>> = openChecks.slice(0, 4).map((r, i) => ({
      id: `step_${i}`,
      label: checkActionPrompt(r.check.label, t),
      // checkGap localizes the journey gap by check id — the raw evaluate()
      // string is English at source (i18n gap audit 21/07). Fall back to the
      // localized label, never the raw English one.
      description:
        checkGap(r.check.id, r.result.gap, t, locale) || checkLabel(r.check.id, r.check.label, t),
      credits: 1,
    }));
    if (scoringFirst) {
      const scoringLabel = t('journey-prompt.scoring');
      // Drop the prefill twin of the same ask (the "Startup Scoring baseline"
      // open check maps to the identical label) before prepending the runner.
      options = options.filter((o) => o.label !== scoringLabel);
      // NO credits field — per-action price quotes were deleted from every
      // founder surface (PR #187); the click still runs the skill via skill_id.
      options.unshift({
        id: 'run_startup_scoring',
        label: scoringLabel,
        skill_id: 'startup-scoring',
      });
    }
    const optArtifact = `:::artifact{"type":"option-set","id":"opt_brief"}\n${JSON.stringify({ prompt: t('brief.where-to-start'), options })}\n:::`;
    content = `${prose}\n\n${optArtifact}`;
  }

  const id = generateId('msg');
  const now = new Date().toISOString();
  await run(
    `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
     VALUES (?, ?, 'chat', 'assistant', ?, ?, ?)`,
    id, projectId, content, now, userId,
  );

  return json({ briefed: true });
}
