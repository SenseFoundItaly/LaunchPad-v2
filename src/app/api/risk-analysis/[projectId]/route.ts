/**
 * Roadmap 1.1 — structured risk audit per project.
 *
 * Leverages the same methodology already defined in
 * launchpad-skills/risk-scoring/SKILL.md (5-dim audit: market, technical,
 * regulatory, team, financial + dependency; each risk carries probability,
 * impact, mitigation owner, and a watch list). Running as a direct endpoint
 * (rather than only via agent auto-invocation in chat) gives the UI a
 * deterministic "click to audit" trigger and a stable retrieval shape.
 *
 * Storage: `simulation.risk_scenarios` JSON column. The `simulation` table
 * is PRIMARY KEY on project_id, so upsert semantics are natural.
 */

import { NextRequest } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { get, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { chatJSONByTask } from '@/lib/llm';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { recordEvent } from '@/lib/memory/events';

const RISK_SKILL_PATH = join(process.cwd(), 'launchpad-skills', 'risk-scoring', 'SKILL.md');

function loadRiskPrompt(): string {
  if (!existsSync(RISK_SKILL_PATH)) return '';
  const raw = readFileSync(RISK_SKILL_PATH, 'utf-8');
  // Strip YAML frontmatter, keep the body (instructions + JSON schema).
  const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return (match?.[1] ?? raw).trim();
}

/**
 * POST /api/risk-analysis/:projectId
 *
 * Runs a fresh risk audit on the project and upserts the result into
 * simulation.risk_scenarios. Returns the parsed audit JSON.
 *
 * Body is optional — if `{context: string}` is provided, it's fed as a
 * focus hint (e.g. "focus on IP and regulatory risk around GDPR").
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  // Load the project to ensure ownership + grab context for the prompt.
  const project = await get<{
    id: string; name: string; description: string; current_step: number;
    owner_user_id: string | null; org_id: string | null;
  }>(
    'SELECT id, name, description, current_step, owner_user_id, org_id FROM projects WHERE id = $1',
    projectId,
  );
  if (!project) return error('Project not found', 404);
  // The shadow-user upsert in requireUser() already linked userId to org;
  // cross-check project ownership the same way the projects route does.
  if (project.owner_user_id && project.owner_user_id !== userId) {
    return error('Forbidden', 403);
  }

  let body: { context?: string } = {};
  try { body = await request.json(); } catch { /* body is optional */ }

  const prompt = loadRiskPrompt();
  if (!prompt) {
    return error('Risk-scoring skill body not found on disk', 500);
  }

  // Pull any existing score dimensions so the auditor has scoring context.
  const score = await get<{ overall_score: number; dimensions: string }>(
    'SELECT overall_score, dimensions FROM scores WHERE project_id = $1',
    projectId,
  );

  const projectContext = [
    `PROJECT: ${project.name}`,
    project.description ? `DESCRIPTION: ${project.description}` : null,
    `CURRENT STAGE: step ${project.current_step}`,
    score ? `OVERALL SCORE: ${score.overall_score}/10` : null,
    score?.dimensions ? `DIMENSION SCORES: ${score.dimensions}` : null,
    body.context ? `FOCUS HINT: ${body.context}` : null,
  ].filter(Boolean).join('\n');

  const messages = [
    {
      role: 'system' as const,
      content: `${prompt}\n\nReturn ONLY valid JSON matching the schema at the bottom of these instructions. No prose, no markdown fences, no commentary.`,
    },
    {
      role: 'user' as const,
      content: `Run the risk audit for this project:\n\n${projectContext}`,
    },
  ];

  let audit: unknown;
  try {
    audit = await chatJSONByTask(messages, 'risk-analysis', 0.3, {
      project_id: projectId,
      skill_id: 'risk-scoring',
      step: 'risk-analysis',
    });
  } catch (err) {
    return error(`Risk audit failed: ${(err as Error).message}`, 500);
  }

  // Extract the top-level + per-risk sources into a flat array so the
  // readiness UI can render them as a single source bar on the risk widget.
  // The full structure stays in risk_scenarios JSON (including per-risk
  // sources); scenario_sources is a flattened convenience copy for queries
  // that don't want to parse the full audit blob.
  const flatSources: unknown[] = [];
  try {
    const auditObj = (audit as { risk_audit?: { sources?: unknown[]; top_risks?: Array<{ sources?: unknown[] }> } })?.risk_audit;
    if (auditObj?.sources) flatSources.push(...auditObj.sources);
    if (Array.isArray(auditObj?.top_risks)) {
      for (const r of auditObj.top_risks) {
        if (Array.isArray(r?.sources)) flatSources.push(...r.sources);
      }
    }
  } catch {
    // best-effort — if the shape differs, we still persist risk_scenarios
  }
  const flatSourcesJson = flatSources.length > 0 ? JSON.stringify(flatSources) : null;

  // Upsert into simulation.risk_scenarios (preserves any existing personas).
  try {
    const existing = await get<{ project_id: string }>('SELECT project_id FROM simulation WHERE project_id = $1', projectId);
    if (existing) {
      await run(
        'UPDATE simulation SET risk_scenarios = $1, scenario_sources = COALESCE($2, scenario_sources), simulated_at = CURRENT_TIMESTAMP WHERE project_id = $3',
        JSON.stringify(audit),
        flatSourcesJson,
        projectId,
      );
    } else {
      await run(
        'INSERT INTO simulation (project_id, risk_scenarios, scenario_sources) VALUES ($1, $2, $3)',
        projectId,
        JSON.stringify(audit),
        flatSourcesJson,
      );
    }

    await recordEvent({
      userId,
      projectId,
      eventType: 'skill_completed',
      payload: { skill_id: 'risk-scoring', source: 'direct-endpoint' },
    });
  } catch (err) {
    console.warn('[risk-analysis] persist failed (returning result anyway):', err);
  }

  return json(audit);
}

/**
 * GET /api/risk-analysis/:projectId
 *
 * Returns the most recently stored risk audit for the project.
 * 404 if no audit has ever been run.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  try {
    await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const row = await get<{ risk_scenarios: string | null; simulated_at: string }>(
    'SELECT risk_scenarios, simulated_at FROM simulation WHERE project_id = $1',
    projectId,
  );
  if (!row || !row.risk_scenarios) return error('No risk audit yet', 404);

  // risk_scenarios is JSONB — postgres.js returns it already parsed
  const audit: unknown = row.risk_scenarios;

  return json({ audit, generated_at: row.simulated_at });
}
