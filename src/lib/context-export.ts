/**
 * context-export.ts — Pure utility that builds a Markdown snapshot of full
 * project context (score, pipeline, audit gaps, facts, alerts, entities,
 * briefs, tasks, risks, artifacts, chat history).
 *
 * No React / DOM dependencies — safe to import from any module.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StageData {
  name: string;
  order: number;
  completion_ratio: number;
  overall_score: number;
  verdict: string;
  recommendations: string[];
}

interface FactData { fact: string; kind: string; confidence: number; sources?: unknown[] }
interface AlertData { headline: string; body: string | null; alert_type: string; source: string | null; relevance_score?: number | null; source_url?: string | null }
interface NodeData { name: string; node_type: string; summary: string | null }
interface ScoreData { overall_score: number | null; benchmark: string | null; recommendation?: string | null }

interface BriefData {
  title: string;
  narrative: string;
  confidence: number;
  urgent_actions: string[];
  brief_type?: string | null;
  entity_name?: string | null;
  signal_count?: number | null;
  valid_until?: string | null;
}

interface TaskData { title: string; priority: string | null; rationale?: string | null; sources?: unknown[] }
interface RiskData { id: string; title: string; probability: number; impact: number; severity: number }
interface ArtifactData { type: string; title: string }

interface MessageData {
  role: string;
  content: string;
  timestamp?: string;
}

export interface ContextExportData {
  project: { name: string; description?: string; status: string };
  date: string;
  score: ScoreData | null;
  stages: StageData[];
  facts: FactData[];
  alerts: AlertData[];
  nodes: NodeData[];
  briefs: BriefData[];
  tasks: TaskData[];
  risks: RiskData[];
  artifacts: ArtifactData[];
  messages: MessageData[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MSG_CAP = 2000;

function cap(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) + '\u2026' : text;
}

/** Strip agent formatting from message content */
function stripAgentFormatting(text: string): string {
  let result = text;
  // Strip :::artifact … ::: blocks
  result = result.replace(/:::artifact[\s\S]*?:::/g, '');
  // Strip <tool_use>...</tool_use> blocks
  result = result.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '');
  // Strip <tool_result>...</tool_result> blocks
  result = result.replace(/<tool_result>[\s\S]*?<\/tool_result>/g, '');
  // Collapse 3+ consecutive blank lines to 2
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildContextMarkdown(data: ContextExportData): string {
  const lines: string[] = [];

  // ── 1. Header ──────────────────────────────────────────────
  lines.push(`# ${data.project.name} \u2014 Context Export`);
  lines.push('');
  lines.push(`**Date:** ${data.date}`);
  lines.push(`**Status:** ${data.project.status}`);
  if (data.project.description) {
    lines.push('');
    lines.push(`> ${cap(data.project.description, 500)}`);
  }
  lines.push('');

  // ── 2. Readiness Score ─────────────────────────────────────
  lines.push('---');
  lines.push('## Readiness Score');
  lines.push('');
  if (data.score && data.score.overall_score !== null) {
    lines.push(`**Score:** ${Number(data.score.overall_score).toFixed(1)} / 10`);
    if (data.score.benchmark) lines.push(`**Benchmark:** ${data.score.benchmark}`);
    if (data.score.recommendation) lines.push(`**Recommendation:** ${data.score.recommendation}`);
  } else {
    lines.push('*Score not yet computed.*');
  }
  lines.push('');

  // ── 3. Validation Pipeline ─────────────────────────────────
  lines.push('---');
  lines.push('## Validation Pipeline');
  lines.push('');
  if (data.stages.length === 0) {
    lines.push('*No validation stages started.*');
  } else {
    for (const s of data.stages) {
      const pct = Math.round(s.completion_ratio * 100);
      lines.push(`- **${String(s.order).padStart(2, '0')}. ${s.name}** \u2014 ${s.verdict.replace(/_/g, ' ').toUpperCase()} \u00b7 ${pct}% \u00b7 score ${s.overall_score.toFixed(1)}/10`);
    }
  }
  lines.push('');

  // ── 4. Audit Gaps ──────────────────────────────────────────
  const stagesWithGaps = data.stages.filter(s => s.recommendations.length > 0);
  if (stagesWithGaps.length > 0) {
    lines.push('---');
    lines.push('## Audit Gaps');
    lines.push('');
    for (const s of stagesWithGaps) {
      lines.push(`**${s.name}:**`);
      for (const rec of s.recommendations) {
        lines.push(`- ${rec}`);
      }
    }
    lines.push('');
  }

  // ── 5. Memory Facts ────────────────────────────────────────
  lines.push('---');
  lines.push('## Memory Facts');
  lines.push('');
  if (data.facts.length === 0) {
    lines.push('*No facts recorded yet.*');
  } else {
    for (const f of data.facts) {
      lines.push(`- [${f.kind}] ${f.fact} *(conf ${Math.round(f.confidence * 100)}%)*`);
      if (f.sources && Array.isArray(f.sources) && f.sources.length > 0) {
        const sourceNames = f.sources.map((s: unknown) => {
          const src = s as Record<string, unknown>;
          return src.title || src.type || 'unknown';
        }).join(', ');
        lines.push(`  Sources: ${sourceNames}`);
      }
    }
  }
  lines.push('');

  // ── 6. Active Alerts ───────────────────────────────────────
  lines.push('---');
  lines.push('## Active Alerts');
  lines.push('');
  if (data.alerts.length === 0) {
    lines.push('*No active alerts.*');
  } else {
    for (const a of data.alerts) {
      const src = a.source ? ` (${a.source})` : '';
      const relevance = a.relevance_score != null ? ` [relevance: ${Math.round(a.relevance_score * 100)}%]` : '';
      lines.push(`- **${a.headline}**${src}${relevance} \u2014 ${a.alert_type.replace(/_/g, ' ')}`);
      if (a.body) lines.push(`  ${cap(a.body, 220)}`);
      if (a.source_url) lines.push(`  Link: ${a.source_url}`);
    }
  }
  lines.push('');

  // ── 7. Graph Entities ──────────────────────────────────────
  lines.push('---');
  lines.push('## Graph Entities');
  lines.push('');
  if (data.nodes.length === 0) {
    lines.push('*No entities mapped yet.*');
  } else {
    for (const n of data.nodes) {
      lines.push(`- **${n.name}** (${n.node_type})${n.summary ? ' \u2014 ' + cap(n.summary, 180) : ''}`);
    }
  }
  lines.push('');

  // ── 8. Intelligence Briefs ─────────────────────────────────
  lines.push('---');
  lines.push('## Intelligence Briefs');
  lines.push('');
  if (data.briefs.length === 0) {
    lines.push('*No active briefs.*');
  } else {
    for (const b of data.briefs) {
      const typeBadge = b.brief_type ? `[${b.brief_type}] ` : '';
      const entity = b.entity_name ? `**${b.entity_name}** \u2014 ` : '';
      const signals = b.signal_count ? ` (${b.signal_count} signals)` : '';
      const validity = b.valid_until ? ` *(valid until ${b.valid_until})*` : '';
      lines.push(`### ${typeBadge}${entity}${b.title} *(conf ${Math.round(b.confidence * 100)}%)*${signals}${validity}`);
      lines.push(cap(b.narrative, 300));
      if (b.urgent_actions.length > 0) {
        lines.push(`**Urgent:** ${b.urgent_actions.join('; ')}`);
      }
      lines.push('');
    }
  }
  lines.push('');

  // ── 9. Open Tasks ──────────────────────────────────────────
  lines.push('---');
  lines.push('## Open Tasks');
  lines.push('');
  if (data.tasks.length === 0) {
    lines.push('*No open tasks.*');
  } else {
    for (const t of data.tasks) {
      lines.push(`- [${t.priority || 'medium'}] ${t.title}`);
      if (t.rationale) lines.push(`  *Rationale:* ${cap(t.rationale, 200)}`);
    }
  }
  lines.push('');

  // ── 10. Top Risks ─────────────────────────────────────────
  lines.push('---');
  lines.push('## Top Risks');
  lines.push('');
  if (data.risks.length === 0) {
    lines.push('*No risks identified yet.*');
  } else {
    for (const r of data.risks) {
      lines.push(`- **${r.title}** \u2014 severity ${Math.round(r.severity * 100)}% (P=${Math.round(r.probability * 100)}% I=${Math.round(r.impact * 100)}%)`);
    }
  }
  lines.push('');

  // ── 11. Artifacts ──────────────────────────────────────────
  lines.push('---');
  lines.push('## Artifacts');
  lines.push('');
  if (data.artifacts.length === 0) {
    lines.push('*No artifacts generated yet.*');
  } else {
    for (const a of data.artifacts) {
      lines.push(`- **${a.title}** (${a.type})`);
    }
  }
  lines.push('');

  // ── 12. Chat History ───────────────────────────────────────
  lines.push('---');
  lines.push('## Chat History');
  lines.push('');
  if (data.messages.length === 0) {
    lines.push('*No messages yet.*');
  } else {
    for (const m of data.messages) {
      const ts = m.timestamp ? ` \u2014 ${m.timestamp}` : '';
      const role = m.role === 'user' ? 'You' : 'Co-pilot';
      const body = cap(stripAgentFormatting(m.content), MSG_CAP);
      lines.push(`**${role}**${ts}`);
      lines.push(body);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('*Exported from LaunchPad*');

  return lines.join('\n');
}
