import { NextRequest } from 'next/server';
import { json, error, generateId } from '@/lib/api-helpers';
import { run, get, query } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth/require-user';
import { runAgent } from '@/lib/pi-agent';
import { recordAgentUsage } from '@/lib/cost-meter';
import { buildProjectSnapshot, evaluateAllStages } from '@/lib/journey';

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

// Keyword-mapped actionable prompt for an open validation check (same logic as
// the chat empty-state, kept here so the brief's option-set is self-contained).
function nextStepPrompt(label: string): string {
  const l = label.toLowerCase();
  if (/segment|icp|ideal customer|persona|beachhead/.test(l)) return 'Help me define and validate my target customer segment.';
  if (/competitor/.test(l)) return 'Research and map my top competitors.';
  if (/interview/.test(l)) return "Help me log customer interviews — I'll tell you who I spoke to and what they said.";
  if (/watcher|monitor/.test(l)) return 'Set up a watcher on my key competitors or market trends.';
  if (/market size|\btam\b|\bsam\b|\bsom\b/.test(l)) return 'Help me size my market (TAM / SAM / SOM).';
  if (/channel|acquisition|reach|distribution/.test(l)) return 'Help me identify my acquisition channels.';
  if (/business model|revenue|pricing|unit econ/.test(l)) return 'Help me define my business model.';
  if (/differentiat|competitive|edge|advantage/.test(l)) return "Help me articulate how I'm different from competitors.";
  if (/value prop/.test(l)) return 'Help me sharpen my value proposition.';
  if (/problem/.test(l)) return 'Help me sharpen my problem statement.';
  if (/solution/.test(l)) return 'Help me describe my solution in more depth.';
  return `Help me with: ${label}`;
}

interface CanvasRow {
  problem: string | null;
  solution: string | null;
  target_market: string | null;
  value_proposition: string | null;
  business_model: string | null;
  competitive_advantage: string | null;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }
  const { projectId } = await params;

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
    `SELECT problem, solution, target_market, value_proposition, business_model, competitive_advantage
       FROM idea_canvas WHERE project_id = ?`,
    projectId,
  );
  const entities = await query<{ name: string; node_type: string | null }>(
    `SELECT name, node_type FROM graph_nodes
      WHERE project_id = ? AND node_type != 'your_startup'
      ORDER BY created_at DESC LIMIT 20`,
    projectId,
  );

  const active = evals.find((e) => e.status === 'active');
  const doneStages = evals.filter((e) => e.status === 'done');
  const openChecks = active ? active.results.filter((r) => !r.result.passed) : [];

  const canvasLines = canvas
    ? ([
        ['Problem', canvas.problem],
        ['Solution', canvas.solution],
        ['Target market', canvas.target_market],
        ['Value proposition', canvas.value_proposition],
        ['Business model', canvas.business_model],
        ['Competitive edge', canvas.competitive_advantage],
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
Keep it conversational — no markdown headers, minimal bullets. Do NOT invent facts beyond the context. Do NOT emit any artifact blocks; just the prose.

CONTEXT:
${ctx}`;

  let prose = '';
  const startedAt = Date.now();
  try {
    const { text, usage } = await runAgent(prompt, { task: 'chat', tools: false, timeout: 40_000 });
    prose = (text || '').trim();
    // Meter the LLM cost → credits deducted (fire-and-forget; returns void).
    recordAgentUsage({
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
  if (openChecks.length > 0) {
    const options = openChecks.slice(0, 4).map((r, i) => ({
      id: `step_${i}`,
      label: nextStepPrompt(r.check.label),
      description: r.result.gap || r.check.label,
      credits: 1,
    }));
    const optArtifact = `:::artifact{"type":"option-set","id":"opt_brief"}\n${JSON.stringify({ prompt: 'Where do you want to start?', options })}\n:::`;
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
