// ============================================================================
// Build Hub issue/feature backlog layer (GitHub #267).
//
// Raw mvp_build_feedback rows are EVIDENCE; they roll up into deduped ISSUES
// grouped under FEATURE labels. Intake is classify-on-arrival: every new
// feedback row gets a cheap-tier match-or-spawn against the project's open
// issues, so the backlog stays organized continuously and repeated signals
// raise an issue's evidence_count instead of duplicating bullets.
//
// FAIL-OPEN: if classification errors (LLM down, bad JSON), the feedback row
// simply stays unattached (issue_id NULL) — the proposer falls back to raw
// pending feedback, and a later ingest can still adopt the orphan.
// ============================================================================

import { query, get, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { runAgent } from '@/lib/pi-agent';
import { addFeedback, type AddFeedbackInput, type MvpBuildFeedback } from './mvp-builds';

export interface MvpBuildIssue {
  id: string;
  project_id: string;
  feature: string;
  title: string;
  severity: string | null;
  status: string;
  evidence_count: number;
  shipped_in_iteration: number | null;
  created_at: string;
  updated_at: string;
}

const SEV_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

function maxSeverity(a: string | null | undefined, b: string | null | undefined): string | null {
  const ra = SEV_RANK[a ?? ''] ?? 0;
  const rb = SEV_RANK[b ?? ''] ?? 0;
  if (ra === 0 && rb === 0) return null;
  return ra >= rb ? (a ?? b ?? null) : (b as string);
}

export async function listOpenIssues(projectId: string): Promise<MvpBuildIssue[]> {
  return query<MvpBuildIssue>(
    `SELECT * FROM mvp_build_issues
      WHERE project_id = ? AND status IN ('open', 'planned')
      ORDER BY evidence_count DESC, created_at ASC`,
    projectId,
  );
}

export async function getIssues(projectId: string, ids: string[]): Promise<MvpBuildIssue[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return query<MvpBuildIssue>(
    `SELECT * FROM mvp_build_issues WHERE project_id = ? AND id IN (${placeholders})`,
    projectId,
    ...ids,
  );
}

async function spawnIssue(
  projectId: string,
  input: { feature: string; title: string; severity?: string | null },
): Promise<MvpBuildIssue> {
  const id = generateId('mvpi');
  const rows = await run(
    `INSERT INTO mvp_build_issues (id, project_id, feature, title, severity, evidence_count)
     VALUES (?, ?, ?, ?, ?, 1) RETURNING *`,
    id,
    projectId,
    input.feature.slice(0, 60) || 'General',
    input.title.slice(0, 200),
    input.severity ?? null,
  );
  return rows[0] as unknown as MvpBuildIssue;
}

async function attachEvidence(issue: MvpBuildIssue, feedback: MvpBuildFeedback): Promise<void> {
  await run(
    `UPDATE mvp_build_issues
        SET evidence_count = evidence_count + 1,
            severity = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    maxSeverity(issue.severity, feedback.severity),
    issue.id,
  );
  await run(`UPDATE mvp_build_feedback SET issue_id = ? WHERE id = ?`, issue.id, feedback.id);
}

/** Mark the issues implemented by a settled iteration as shipped. */
export async function markIssuesShipped(
  projectId: string,
  issueIds: string[],
  iteration: number,
): Promise<void> {
  if (issueIds.length === 0) return;
  const placeholders = issueIds.map(() => '?').join(', ');
  await run(
    `UPDATE mvp_build_issues
        SET status = 'shipped', shipped_in_iteration = ?, updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ? AND id IN (${placeholders}) AND status != 'shipped'`,
    iteration,
    projectId,
    ...issueIds,
  );
}

// ── Cluster selection (pure — used by the iteration proposer) ───────────────

export interface IssueCluster {
  feature: string;
  issues: MvpBuildIssue[];
  anyHigh: boolean;
  evidenceTotal: number;
}

/**
 * Group open issues by feature and pick the highest-value cluster: any
 * high-severity beats all, then total evidence, then issue count. One coherent
 * cluster per iteration — v0 implements a focused instruction well and a
 * laundry list badly; the rest stays pending for the next round.
 */
export function pickTopCluster(issues: MvpBuildIssue[]): IssueCluster | null {
  if (issues.length === 0) return null;
  const byFeature = new Map<string, MvpBuildIssue[]>();
  for (const i of issues) {
    const k = i.feature || 'General';
    byFeature.set(k, [...(byFeature.get(k) ?? []), i]);
  }
  const clusters: IssueCluster[] = [...byFeature.entries()].map(([feature, list]) => ({
    feature,
    issues: list,
    anyHigh: list.some((i) => i.severity === 'high'),
    evidenceTotal: list.reduce((s, i) => s + (i.evidence_count || 0), 0),
  }));
  clusters.sort((a, b) => {
    if (a.anyHigh !== b.anyHigh) return a.anyHigh ? -1 : 1;
    if (a.evidenceTotal !== b.evidenceTotal) return b.evidenceTotal - a.evidenceTotal;
    return b.issues.length - a.issues.length;
  });
  return clusters[0];
}

const READY_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Batching threshold (#271): an iteration costs a real driver credit, so only
 * propose when the backlog is WORTH one — ≥2 issues in the cluster, or any
 * high-severity, or the oldest issue has waited a week.
 */
export function clusterReady(cluster: IssueCluster, nowMs: number): boolean {
  if (cluster.issues.length >= 2) return true;
  if (cluster.anyHigh) return true;
  return cluster.issues.some((i) => nowMs - new Date(i.created_at).getTime() >= READY_AGE_MS);
}

// ── Intake classifier (cheap tier, match-or-spawn) ──────────────────────────

function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function classify(
  projectId: string,
  body: string,
  openIssues: MvpBuildIssue[],
): Promise<{ matchId?: string; feature?: string; title?: string; severity?: string }> {
  const issueList = openIssues
    .slice(0, 30)
    .map((i) => `- id=${i.id} [${i.feature}] ${i.title}`)
    .join('\n');
  const res = await runAgent(
    `A founder gave product feedback on their MVP:\n"""${body.slice(0, 800)}"""\n\nOpen issues:\n${issueList || '(none)'}\n\nIf this feedback is the SAME underlying request as one open issue, answer {"match": "<issue id>"}. Otherwise answer {"new": {"feature": "<1-2 word area, e.g. Pricing, Onboarding, Auth, Design>", "title": "<short actionable imperative, e.g. add a plan toggle>", "severity": "low"|"medium"|"high"}}. Answer with ONLY the JSON object.`,
    {
      systemPrompt:
        'You triage product feedback into a deduplicated issue backlog. Be conservative about matching: only match when the underlying request is the same, not merely the same area.',
      tools: false,
      projectId,
      step: 'build.feedback-classify',
      task: 'signal-classify',
      timeout: 20_000,
    },
  );
  const parsed = extractJson(res.text) ?? {};
  if (typeof parsed.match === 'string') return { matchId: parsed.match };
  const n = (parsed.new ?? parsed) as Record<string, unknown>;
  if (typeof n.title === 'string' && n.title.trim()) {
    return {
      feature: typeof n.feature === 'string' && n.feature.trim() ? n.feature.trim() : 'General',
      title: n.title.trim(),
      severity: typeof n.severity === 'string' ? n.severity : undefined,
    };
  }
  throw new Error('classifier returned no usable JSON');
}

/**
 * The single intake path for build feedback: persist the raw evidence, then
 * classify it into the issue backlog (match-or-spawn). All writers (Build pane,
 * chat tool, interview/watcher converters) should come through here.
 */
export async function ingestFeedback(
  input: AddFeedbackInput,
): Promise<{ feedback: MvpBuildFeedback; issue: MvpBuildIssue | null }> {
  const feedback = await addFeedback(input);
  try {
    const open = await listOpenIssues(input.projectId);
    const verdict = await classify(input.projectId, input.body, open);
    if (verdict.matchId) {
      const issue =
        open.find((i) => i.id === verdict.matchId) ??
        (await get<MvpBuildIssue>(
          'SELECT * FROM mvp_build_issues WHERE id = ? AND project_id = ?',
          verdict.matchId,
          input.projectId,
        ));
      if (issue) {
        await attachEvidence(issue, feedback);
        return { feedback, issue };
      }
    }
    if (verdict.title) {
      const issue = await spawnIssue(input.projectId, {
        feature: verdict.feature ?? 'General',
        title: verdict.title,
        severity: verdict.severity ?? input.severity ?? null,
      });
      await run(`UPDATE mvp_build_feedback SET issue_id = ? WHERE id = ?`, issue.id, feedback.id);
      return { feedback, issue };
    }
  } catch (err) {
    console.warn('[build-issues] classify failed (fail-open, feedback kept):', (err as Error).message);
  }
  return { feedback, issue: null };
}
