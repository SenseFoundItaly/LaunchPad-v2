import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { gatherProjectContext } from '@/lib/memory/gather-context';
import { STAGES } from '@/lib/stages';
import { scoreStage } from '@/lib/scoring';
import type { SkillData } from '@/hooks/useSkillStatus';

/**
 * GET /api/projects/{projectId}/context-export
 *
 * Gathers full project context in one round-trip for the export button.
 * Returns all data needed by buildContextMarkdown() in context-export.ts.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const ctx = await gatherProjectContext(auth.session.userId, projectId, {
    maxFacts: 20,
    maxBriefs: 5,
    maxTasks: 15,
    maxGraphNodes: 10,
    maxRisks: 5,
    maxAlerts: 10,
    maxSkills: 100, // need all skills for stage scoring
    includeMessages: true,
    includeGraphNodes: true,
    includeAlerts: true,
    enriched: true, // export always gets full enrichment
  });

  if (!ctx.project) return error('Project not found', 404);

  // Build skillMap from gathered skill completions for stage scoring
  const skillMap: Record<string, SkillData> = {};
  for (const stage of STAGES) {
    for (const skill of stage.skills) {
      const found = ctx.skills?.find((c) => c.skill_id === skill.id);
      skillMap[skill.id] = found && found.status === 'completed'
        ? { status: 'completed', summary: found.summary ?? undefined, completedAt: found.completed_at }
        : { status: 'not_run' };
    }
  }

  const stages = STAGES.map((stage) => {
    const ss = scoreStage(stage.number, skillMap);
    const completedSkills = stage.skills.filter((s) => skillMap[s.id]?.status === 'completed');
    const ratio = stage.skills.length > 0 ? completedSkills.length / stage.skills.length : 0;
    return {
      name: stage.name,
      order: stage.number,
      completion_ratio: Math.round(ratio * 100) / 100,
      overall_score: ss.score,
      verdict: ss.verdict.toLowerCase().replace(/\s+/g, '_'),
      recommendations: ss.recommendations,
    };
  });

  // Format facts for export (include sources when available)
  const facts = (ctx.facts ?? []).map((f) => ({
    fact: f.fact,
    kind: f.kind,
    confidence: f.confidence,
    ...(f.sources ? { sources: f.sources } : {}),
  }));

  // Format briefs with urgent actions extracted
  const briefs = (ctx.briefs ?? []).map((b) => {
    let urgent_actions: string[] = [];
    try {
      const actions = b.recommended_actions
        ? (typeof b.recommended_actions === 'string' ? JSON.parse(b.recommended_actions) : b.recommended_actions)
        : [];
      if (Array.isArray(actions)) {
        urgent_actions = actions
          .filter((a: { urgency?: string }) => a.urgency === 'high' || a.urgency === 'critical')
          .map((a: { action?: string; title?: string }) => a.action || a.title || '')
          .filter(Boolean);
      }
    } catch { /* malformed JSON — skip */ }
    return {
      title: b.title,
      narrative: b.narrative,
      confidence: b.confidence,
      urgent_actions,
      ...(b.brief_type ? { brief_type: b.brief_type } : {}),
      ...(b.entity_name ? { entity_name: b.entity_name } : {}),
      ...(b.signal_count != null ? { signal_count: b.signal_count } : {}),
      ...(b.valid_until ? { valid_until: b.valid_until } : {}),
    };
  });

  // Map tasks with enriched fields
  const tasks = (ctx.tasks ?? []).map((t) => ({
    title: t.title,
    priority: t.priority,
    ...(t.rationale ? { rationale: t.rationale } : {}),
    ...(t.sources ? { sources: t.sources } : {}),
  }));

  // Map alerts with enriched fields
  const alerts = (ctx.alerts ?? []).map((a) => ({
    headline: a.headline,
    body: a.body,
    alert_type: a.alert_type,
    source: a.source,
    ...(a.relevance_score != null ? { relevance_score: a.relevance_score } : {}),
    ...(a.source_url ? { source_url: a.source_url } : {}),
  }));

  return json({
    project: {
      name: ctx.project.name,
      description: ctx.project.description || undefined,
      status: ctx.project.status,
    },
    score: ctx.score ?? null,
    stages,
    facts,
    alerts,
    nodes: ctx.graphNodes ?? [],
    briefs,
    tasks,
    risks: ctx.risks ?? [],
    messages: (ctx.messages ?? []).map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
  });
}
