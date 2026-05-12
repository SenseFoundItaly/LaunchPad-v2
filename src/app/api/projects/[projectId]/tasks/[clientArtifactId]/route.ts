import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { query, run, get } from '@/lib/db';
import {
  getPendingAction,
  approvePendingAction,
  rejectPendingAction,
  markActionSent,
  InvalidTransitionError,
} from '@/lib/pending-actions';
import { getCreditsRemaining } from '@/lib/credits';
import { runAgent } from '@/lib/pi-agent';
import { recordUsage } from '@/lib/cost-meter';
import { pickModel } from '@/lib/llm/router';
import { recordEvent } from '@/lib/memory/events';
import type { Source } from '@/types/artifacts';

/**
 * Tasks resolved by the *client artifact id* (not the pending_actions row id).
 *
 * Why: when the agent emits a `:::artifact{type:"task", id:"task_abc"}` block
 * in raw text (no tool call), persistence creates the matching pending_actions
 * row AFTER the assistant message is already streamed and saved. The artifact
 * JSON in chat_messages therefore never carries a server-assigned
 * `pending_action_id` — but it does carry the agent-chosen `id` field.
 *
 * Persistence stores that id in `payload.client_artifact_id`, and the inline
 * TaskCard hits this endpoint with it to address its row without a list-fetch
 * round-trip.
 *
 * For tool-emitted tasks (future create_task path), the artifact will already
 * carry `pending_action_id` and the TaskCard can hit /actions/[actionId]
 * directly — both paths coexist.
 */

interface TaskRow {
  id: string;
  status: string;
  payload: Record<string, unknown> | null;
  title: string | null;
  rationale: string | null;
  priority: string | null;
}

async function findByClientArtifactId(projectId: string, clientArtifactId: string): Promise<TaskRow | null> {
  const rows = await query<TaskRow>(
    `SELECT id, status, payload, title, rationale, priority FROM pending_actions
     WHERE project_id = ?
       AND action_type = 'task'
       AND payload->>'client_artifact_id' = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    projectId,
    clientArtifactId,
  );
  return rows[0] || null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; clientArtifactId: string }> },
) {
  const { projectId, clientArtifactId } = await params;
  const row = await findByClientArtifactId(projectId, clientArtifactId);
  if (!row) return error('Task not found for this artifact id', 404);
  const action = await getPendingAction(row.id);
  return json(action);
}

/**
 * POST body: { action: 'done' | 'snooze' | 'dismiss' | 'expand',
 *              snooze_hours?: number, reason?: string }
 *
 *   done    → approve + markSent (founder acknowledges; nothing external to dispatch)
 *   snooze  → mutate payload.snooze_until (status stays pending)
 *   dismiss → reject (preference learning hook in /actions route does NOT fire here —
 *             a dismissed task is not a rejected agent draft, it's a founder TODO they
 *             chose not to do; we don't want to teach the agent to stop proposing tasks).
 *   expand  → (Phase G) one LLM turn that decomposes the task into
 *             {details, subtasks, references, estimated_effort}. Fields are
 *             merged into payload; `expanded_at` acts as the idempotency key
 *             (second call returns the existing expansion with HTTP 200 +
 *             already_expanded:true, so the client can render without a second round-trip).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; clientArtifactId: string }> },
) {
  const { projectId, clientArtifactId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body');
  }
  const action = body?.action as string;

  const row = await findByClientArtifactId(projectId, clientArtifactId);
  if (!row) return error('Task not found for this artifact id', 404);

  try {
    switch (action) {
      case 'done': {
        // approve→sent in one POST. The state machine forbids
        // pending→sent directly, hence the two-step transition.
        if (row.status === 'pending' || row.status === 'edited') {
          await approvePendingAction(row.id);
        }
        const updated = await markActionSent(row.id, { target: 'task_completed' });
        return json(updated);
      }
      case 'snooze': {
        const hours = typeof body?.snooze_hours === 'number' ? body.snooze_hours : 24;
        const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        const payload = row.payload ? { ...row.payload } : {};
        payload.snooze_until = until;
        await run(
          `UPDATE pending_actions SET payload = ?, updated_at = ? WHERE id = ?`,
          JSON.stringify(payload),
          new Date().toISOString(),
          row.id,
        );
        const updated = await getPendingAction(row.id);
        return json(updated);
      }
      case 'dismiss': {
        const updated = await rejectPendingAction(row.id, typeof body?.reason === 'string' ? body.reason : undefined);
        return json(updated);
      }
      case 'expand': {
        return await handleExpand(projectId, clientArtifactId, row);
      }
      default:
        return error(`Unknown action: ${action}. Must be one of: done, snooze, dismiss, expand`);
    }
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return error(err.message, 409);
    }
    return error((err as Error).message, 500);
  }
}

// =============================================================================
// Expand handler — Phase G
// =============================================================================

/**
 * System prompt for the expansion turn. The model must return a JSON object
 * with a fixed shape — no prose, no preamble. Keeping this inline (rather
 * than in a separate prompt file) so the coupling between the shape expected
 * below and the instructions above is obvious at review time.
 *
 * Why this shape: the four fields are what turn a one-line TODO into an
 * actionable plan the founder can execute cold three days later. `details`
 * gives them the why, `subtasks` gives them the how, `references` gives them
 * the provenance, `estimated_effort` sets expectations before they start.
 */
const EXPAND_SYSTEM_PROMPT = `You are expanding a founder TODO into an actionable plan.

Your entire response MUST be a single JSON object with EXACTLY these keys — no preamble, no markdown fences, no trailing prose:

{
  "details": "<string, 200-500 chars. Long-form context: what this task involves, why it matters now, what 'done' looks like. Reference the founder's specific idea/problem/target market from the brief below — never generic advice.>",
  "subtasks": ["<string, 3-7 items, each <120 chars, verb-first and actionable — e.g., 'Draft 1-sentence problem statement', 'List 3 target customers by name'>"],
  "references": [<Source[] — skills/research/founder quotes the founder can verify. Use type:"skill" with skill_id when a completed skill is relevant; type:"user" with verbatim quote when the founder said it; type:"internal" with ref + ref_id for research/score rows. Optional (empty [] is allowed if nothing concrete applies), but prefer to cite at least one.>],
  "estimated_effort": "<one of: '30 minutes' | '1 hour' | 'half a day' | '1 day' | '2-3 days' | '1 week' | '2+ weeks'>"
}

Rules:
- Do NOT propose subtasks that require external accounts (Crunchbase Pro, HubSpot paid tier, etc.) unless the founder has already mentioned having them in the brief.
- Do NOT contradict the founder's stated stage — if they're pre-product, don't propose "set up CAC tracking."
- Do NOT pad subtasks with filler ("Think about it", "Reflect on progress"). Every subtask is a concrete step that produces output.
- If the task is genuinely a 30-minute job, say so — don't inflate to look thorough.
- Return the JSON object on its own. Any other text breaks the parser.`;

interface ExpansionFields {
  details: string;
  subtasks: string[];
  references?: Source[];
  estimated_effort: string;
}

const VALID_EFFORTS = new Set([
  '30 minutes', '1 hour', 'half a day', '1 day', '2-3 days', '1 week', '2+ weeks',
]);

function parseExpansion(raw: string): ExpansionFields | null {
  // Strip accidental markdown fences the model sometimes adds despite the rule.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Sometimes the model adds a preamble — try to extract the first {...} block.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { parsed = JSON.parse(match[0]); } catch { return null; }
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;

  if (typeof p.details !== 'string' || p.details.length < 20) return null;
  if (!Array.isArray(p.subtasks) || p.subtasks.length < 1) return null;
  const subtasks = p.subtasks
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim().slice(0, 240));
  if (subtasks.length < 1) return null;
  if (typeof p.estimated_effort !== 'string' || !VALID_EFFORTS.has(p.estimated_effort)) {
    return null;
  }

  const references = Array.isArray(p.references) ? (p.references as Source[]) : [];

  return {
    details: p.details.trim().slice(0, 1500),
    subtasks: subtasks.slice(0, 10),
    references,
    estimated_effort: p.estimated_effort,
  };
}

interface ProjectContext {
  name: string;
  description: string | null;
  problem: string | null;
  solution: string | null;
  target_market: string | null;
  value_proposition: string | null;
  owner_user_id: string | null;
}

async function loadProjectContext(projectId: string): Promise<ProjectContext | null> {
  const project = await get<{ name: string; description: string | null; owner_user_id: string | null }>(
    'SELECT name, description, owner_user_id FROM projects WHERE id = ?',
    projectId,
  );
  if (!project) return null;
  const idea = await get<{
    problem: string | null;
    solution: string | null;
    target_market: string | null;
    value_proposition: string | null;
  }>(
    'SELECT problem, solution, target_market, value_proposition FROM idea_canvas WHERE project_id = ?',
    projectId,
  );
  return {
    name: project.name,
    description: project.description,
    problem: idea?.problem ?? null,
    solution: idea?.solution ?? null,
    target_market: idea?.target_market ?? null,
    value_proposition: idea?.value_proposition ?? null,
    owner_user_id: project.owner_user_id,
  };
}

function buildExpansionPrompt(
  ctx: ProjectContext,
  task: { title: string; description: string | null; priority: string; due: string | null },
): string {
  const lines: string[] = [];
  lines.push(`# Project brief`);
  lines.push(`Name: ${ctx.name}`);
  if (ctx.description) lines.push(`Description: ${ctx.description}`);
  if (ctx.problem) lines.push(`Problem: ${ctx.problem}`);
  if (ctx.solution) lines.push(`Solution: ${ctx.solution}`);
  if (ctx.target_market) lines.push(`Target market: ${ctx.target_market}`);
  if (ctx.value_proposition) lines.push(`Value prop: ${ctx.value_proposition}`);

  lines.push('');
  lines.push(`# Task to expand`);
  lines.push(`Title: ${task.title}`);
  lines.push(`Priority: ${task.priority}`);
  if (task.due) lines.push(`Due: ${task.due}`);
  if (task.description && task.description.trim().length > 0) {
    lines.push(`Description: ${task.description.trim()}`);
  }

  lines.push('');
  lines.push(`Return the JSON object described in the system prompt. Ground every subtask in the project brief above — subtasks that could apply to any startup are forbidden.`);
  return lines.join('\n');
}

async function handleExpand(
  projectId: string,
  clientArtifactId: string,
  row: TaskRow,
) {
  const existingPayload = row.payload ? (row.payload as Record<string, unknown>) : {};

  // Idempotent: if already expanded, return the existing fields without
  // re-billing. We use HTTP 200 (not 409) so the client can simply replace
  // local state — a 409 would force the UI to handle two success shapes.
  if (typeof existingPayload.expanded_at === 'string') {
    return json({
      already_expanded: true,
      details: existingPayload.details,
      subtasks: existingPayload.subtasks,
      references: existingPayload.references,
      estimated_effort: existingPayload.estimated_effort,
      expanded_at: existingPayload.expanded_at,
    });
  }

  // Cost gate — expansion is one LLM turn (cheap tier Haiku). Require at
  // least 3 credits headroom so the credits badge doesn't hit 0 exactly.
  if (await getCreditsRemaining(projectId) < 3) {
    return error(
      'Out of credit headroom for task expansion this month. Raise your cap or wait for next month.',
      402,
    );
  }

  const ctx = await loadProjectContext(projectId);
  if (!ctx) return error('Project not found', 404);

  const prompt = buildExpansionPrompt(ctx, {
    title: row.title ?? '(untitled task)',
    description: row.rationale,
    priority: row.priority ?? 'medium',
    due: typeof existingPayload.due === 'string' ? existingPayload.due : null,
  });

  const startedAt = Date.now();
  let agentText: string;
  let agentUsage;
  try {
    const result = await runAgent(prompt, {
      systemPrompt: EXPAND_SYSTEM_PROMPT,
      task: 'task-expand',
      timeout: 60_000,
      // No tools — the expansion is an analytical single-shot, not an
      // agent loop. Keeping tools off forces a direct JSON response.
      tools: false,
    });
    agentText = result.text;
    agentUsage = result.usage;
  } catch (err) {
    return error(`Expansion failed: ${(err as Error).message}`, 500);
  }
  const latencyMs = Date.now() - startedAt;

  // Cost meter — log against the actual provider/model from the router.
  const { provider, model } = pickModel('task-expand');
  recordUsage({
    project_id: projectId,
    step: 'task-expand',
    provider,
    model,
    usage: agentUsage,
    latency_ms: latencyMs,
  }).catch(err =>
    console.warn('[tasks/expand] recordUsage failed:', (err as Error).message),
  );

  const fields = parseExpansion(agentText);
  if (!fields) {
    return error(
      `Expansion parse failed. The model did not return the required JSON shape. Raw: ${agentText.slice(0, 400)}`,
      500,
    );
  }

  const expandedAt = new Date().toISOString();
  const nextPayload: Record<string, unknown> = {
    ...existingPayload,
    details: fields.details,
    subtasks: fields.subtasks,
    references: fields.references ?? [],
    estimated_effort: fields.estimated_effort,
    expanded_at: expandedAt,
  };

  await run(
    `UPDATE pending_actions SET payload = ?, updated_at = ? WHERE id = ?`,
    JSON.stringify(nextPayload),
    new Date().toISOString(),
    row.id,
  );

  // Timeline event — non-fatal if it fails.
  try {
    if (ctx.owner_user_id) {
      await recordEvent({
        userId: ctx.owner_user_id,
        projectId,
        eventType: 'task_expanded',
        payload: {
          client_artifact_id: clientArtifactId,
          pending_action_id: row.id,
          subtask_count: fields.subtasks.length,
          estimated_effort: fields.estimated_effort,
        },
      });
    }
  } catch (err) {
    console.warn('[tasks/expand] task_expanded recordEvent failed:', (err as Error).message);
  }

  return json({
    already_expanded: false,
    details: fields.details,
    subtasks: fields.subtasks,
    references: fields.references ?? [],
    estimated_effort: fields.estimated_effort,
    expanded_at: expandedAt,
  });
}
