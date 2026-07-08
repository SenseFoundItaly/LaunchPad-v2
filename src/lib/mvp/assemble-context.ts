// ============================================================================
// assembleMvpContext — the unified project-intelligence primitive the codebase
// lacks. Unions the three existing assemblers (journey snapshot + memory context
// + research prose) with the stores they each omit (personas, open assumptions,
// prior build docs, current build + pending feedback), then renders one compact
// prompt block for the mvp-build-spec skill.
//
// renderMvpContextProse() emits "PRIOR SPEC" + "ACCUMULATED FEEDBACK" sections
// ONLY when a current build exists — that single switch turns the same skill from
// an initial-build generator into a delta (iteration) generator.
// ============================================================================

import { get, query } from '@/lib/db';
import { coerceJson } from '@/lib/jsonb';
import { buildProjectSnapshot } from '@/lib/journey/snapshot';
import type { ProjectSnapshot } from '@/lib/journey/types';
import { gatherProjectContext } from '@/lib/memory/gather-context';
import { buildResearchContext } from '@/lib/research-context';
import { getCurrentBuild, listPendingFeedback } from './mvp-builds';

export interface MvpOpenAssumption {
  number: number;
  category: string;
  text: string;
  criticality: string;
}

export interface MvpContext {
  projectId: string;
  ownerUserId: string | null;
  project: { name: string | null; description: string | null } | null;
  snapshot: ProjectSnapshot;
  personas: string[];
  openAssumptions: MvpOpenAssumption[];
  score: number | null;
  briefs: string[];
  researchProse: string;
  /** Last generated build prompt — drives delta mode when present. */
  priorSpec: string | null;
  currentIteration: number;
  pendingFeedback: string[];
  isDelta: boolean;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function personaLabel(raw: unknown, i: number): string {
  if (raw && typeof raw === 'object') {
    const p = raw as Record<string, unknown>;
    const name = p.name ?? p.persona_name ?? p.title ?? p.segment ?? p.role;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return `Persona ${i + 1}`;
}

export async function assembleMvpContext(projectId: string): Promise<MvpContext> {
  const projRow = await safe(
    () =>
      get<{ name: string | null; description: string | null; owner_user_id: string | null }>(
        'SELECT name, description, owner_user_id FROM projects WHERE id = ?',
        projectId,
      ),
    undefined,
  );
  const ownerUserId = projRow?.owner_user_id ?? null;

  const [snapshot, context, personasRow, assumptions, currentBuild, pendingFeedback] =
    await Promise.all([
      buildProjectSnapshot(projectId),
      safe(
        () => gatherProjectContext(ownerUserId ?? '', projectId, { maxBriefs: 3, maxFacts: 12 }),
        null,
      ),
      safe(
        () => get<{ personas: unknown }>('SELECT personas FROM simulation WHERE project_id = ?', projectId),
        undefined,
      ),
      safe(
        () =>
          query<MvpOpenAssumption>(
            `SELECT number, category, text, criticality FROM assumptions
               WHERE project_id = ? AND status = 'open' ORDER BY number ASC LIMIT 12`,
            projectId,
          ),
        [] as MvpOpenAssumption[],
      ),
      safe(() => getCurrentBuild(projectId), undefined),
      safe(() => listPendingFeedback(projectId), []),
    ]);

  const personasArr = coerceJson<unknown[]>(personasRow?.personas) ?? [];
  const personas = Array.isArray(personasArr)
    ? personasArr.slice(0, 6).map((p, i) => personaLabel(p, i))
    : [];

  const score =
    (context?.score as { overall_score?: number } | null | undefined)?.overall_score ?? null;
  const briefs = (context?.briefs ?? [])
    .map((b) => (b as { title?: string }).title)
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .slice(0, 3);

  return {
    projectId,
    ownerUserId,
    project: projRow ? { name: projRow.name, description: projRow.description } : null,
    snapshot,
    personas,
    openAssumptions: assumptions,
    score,
    briefs,
    researchProse: buildResearchContext(snapshot.research),
    priorSpec: currentBuild?.spec_prompt ?? null,
    currentIteration: currentBuild?.iteration ?? 0,
    pendingFeedback: pendingFeedback.map((f) => f.body),
    isDelta: !!currentBuild,
  };
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

function line(label: string, value: string | null | undefined): string | null {
  const v = (value ?? '').toString().trim();
  return v ? `${label}: ${v}` : null;
}

/**
 * Compact prompt block injected into the mvp-build-spec skill. Prioritizes the
 * load-bearing "what to build / for whom" data first; delta sections last.
 */
export function renderMvpContextProse(ctx: MvpContext): string {
  const ic = ctx.snapshot.idea_canvas;
  const out: string[] = ['[PROJECT INTELLIGENCE — build this MVP]'];

  const head = [
    line('Project', ctx.project?.name),
    line('One-liner', ctx.project?.description),
    ctx.score != null ? `Startup score: ${ctx.score}/10` : null,
  ].filter(Boolean) as string[];
  out.push(...head);

  if (ic) {
    out.push('', '## Idea Canvas');
    out.push(
      ...([
        line('Problem', ic.problem),
        line('Solution', ic.solution),
        line('Value proposition', ic.value_proposition),
        line('Target market', ic.target_market),
        line('Business model', ic.business_model),
        line('Channels', ic.channels),
      ].filter(Boolean) as string[]),
    );
  }

  if (ctx.personas.length) {
    out.push('', `## Target personas: ${ctx.personas.join(', ')}`);
  }

  const interviews = ctx.snapshot.interviews ?? [];
  if (interviews.length) {
    out.push('', '## Customer interviews (evidence)');
    for (const iv of interviews.slice(0, 5)) {
      const bits = [
        iv.top_pain ? `pain: ${iv.top_pain}` : null,
        iv.wtp_amount != null ? `WTP: ${iv.wtp_amount}` : null,
        iv.urgency ? `urgency: ${iv.urgency}` : null,
      ].filter(Boolean);
      out.push(`- ${iv.person_name}${bits.length ? ` — ${bits.join(', ')}` : ''}`);
    }
  }

  if (ctx.openAssumptions.length) {
    out.push('', '## Open assumptions the MVP should de-risk');
    for (const a of ctx.openAssumptions.slice(0, 8)) {
      out.push(`- [${a.criticality}] (${a.category}) ${a.text}`);
    }
  }

  if (ctx.researchProse) out.push('', ctx.researchProse.trim());

  if (ctx.briefs.length) {
    out.push('', `## Recent intelligence: ${ctx.briefs.join('; ')}`);
  }

  // Delta mode — only when there is a prior build to iterate on.
  if (ctx.isDelta) {
    if (ctx.priorSpec) {
      out.push(
        '',
        `## PRIOR SPEC (iteration ${ctx.currentIteration}) — iterate on this, do not restart`,
        ctx.priorSpec.slice(0, 12000),
      );
    }
    if (ctx.pendingFeedback.length) {
      out.push('', `## ACCUMULATED FEEDBACK SINCE ITERATION ${ctx.currentIteration}`);
      for (const fb of ctx.pendingFeedback.slice(0, 20)) out.push(`- ${fb}`);
      out.push(
        '',
        'Produce a DELTA: describe only the changes to make (add/modify/remove), framed as instructions to apply to the existing build.',
      );
    }
  }

  return out.join('\n');
}
