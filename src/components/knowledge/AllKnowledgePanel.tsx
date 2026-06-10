'use client';

/**
 * AllKnowledgePanel — the "All knowledge" tab on /knowledge.
 *
 * Renders the unified knowledge read-layer
 * (GET /api/projects/[id]/knowledge/unified): every live item across the
 * fragmented stores (graph_nodes, memory_facts, ecosystem_alerts,
 * intelligence_briefs, competitor_profiles, interviews) as ONE provenance-
 * tagged list — header chips from the summary, items grouped by kind, each
 * row stamped with where it came from and how much to trust it.
 *
 * Provenance badge language is founder-facing, not schema-facing:
 *   founder_asserted    → "self-reported"        (muted — your own claim)
 *   workflow_derived    → "from monitors/skills" (the system produced it)
 *   externally_verified → "verified"             (an independent URL backs it)
 */

import { useQuery } from '@tanstack/react-query';
import { Panel, Pill } from '@/components/design/primitives';
import type {
  KnowledgeItem,
  KnowledgeKind,
  KnowledgeSourceStore,
  KnowledgeSummary,
  ProvenanceTier,
} from '@/lib/knowledge/unified';

interface UnifiedResponse {
  items: KnowledgeItem[];
  summary: KnowledgeSummary;
}

const EMPTY: UnifiedResponse = {
  items: [],
  summary: {
    total: 0,
    byKind: { entity: 0, fact: 0, signal: 0, brief: 0, competitor: 0, interview: 0 },
    byProvenanceTier: { founder_asserted: 0, workflow_derived: 0, externally_verified: 0 },
  },
};

/** Display order + labels for the kind groups. */
const KIND_GROUPS: Array<{ kind: KnowledgeKind; label: string }> = [
  { kind: 'entity', label: 'Entities' },
  { kind: 'competitor', label: 'Competitors' },
  { kind: 'fact', label: 'Facts' },
  { kind: 'signal', label: 'Signals' },
  { kind: 'brief', label: 'Briefs' },
  { kind: 'interview', label: 'Interviews' },
];

const TIER_BADGE: Record<ProvenanceTier, { label: string; kind: 'n' | 'info' | 'ok' }> = {
  founder_asserted: { label: 'self-reported', kind: 'n' },
  workflow_derived: { label: 'from monitors/skills', kind: 'info' },
  externally_verified: { label: 'verified', kind: 'ok' },
};

/** Founder-facing hint for the producing store. */
const STORE_HINT: Record<KnowledgeSourceStore, string> = {
  graph_nodes: 'knowledge graph',
  memory_facts: 'memory fact',
  ecosystem_alerts: 'watcher signal',
  intelligence_briefs: 'intel brief',
  competitor_profiles: 'competitor dossier',
  interviews: 'interview log',
};

export default function AllKnowledgePanel({ projectId }: { projectId: string }) {
  // Keyed under ['knowledge', projectId, ...] so the QueryProvider event
  // bridge auto-invalidates it whenever lp-knowledge-changed fires
  // (KnowledgeReviewList dispatches it on every approve/reject).
  const { data = EMPTY, isLoading, error: errObj } = useQuery<UnifiedResponse>({
    queryKey: ['knowledge', projectId, 'unified'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/knowledge/unified`);
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const payload: UnifiedResponse = body?.data ?? body;
      return {
        items: Array.isArray(payload?.items) ? payload.items : [],
        summary: payload?.summary ?? EMPTY.summary,
      };
    },
  });
  const errorMsg = errObj instanceof Error ? errObj.message : null;

  if (isLoading) return <CenterNote text="Loading project knowledge…" />;
  if (errorMsg) return <CenterNote text={`Couldn’t load knowledge: ${errorMsg}`} tone="error" />;
  if (data.summary.total === 0) {
    return (
      <CenterNote text="Nothing here yet. Chat with the agent, approve proposals in the Review tab, or let watchers land signals — everything the project learns shows up here." />
    );
  }

  const { items, summary } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 920, margin: '0 auto' }}>
      {/* Summary chips — counts by kind, then the provenance split. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Pill kind="live" dot>{summary.total} item{summary.total === 1 ? '' : 's'}</Pill>
        {KIND_GROUPS.filter(g => summary.byKind[g.kind] > 0).map(g => (
          <Pill key={g.kind} kind="n">{summary.byKind[g.kind]} {g.label.toLowerCase()}</Pill>
        ))}
        <span style={{ width: 1, height: 14, background: 'var(--line)', margin: '0 4px' }} />
        {(Object.keys(TIER_BADGE) as ProvenanceTier[])
          .filter(t => summary.byProvenanceTier[t] > 0)
          .map(t => (
            <Pill key={t} kind={TIER_BADGE[t].kind} dot>
              {summary.byProvenanceTier[t]} {TIER_BADGE[t].label}
            </Pill>
          ))}
      </div>

      {KIND_GROUPS.map(({ kind, label }) => {
        const group = items.filter(it => it.kind === kind);
        if (group.length === 0) return null;
        return (
          <Panel key={kind} title={label} subtitle={`${group.length}`}>
            <div>
              {group.map((it, i) => (
                <KnowledgeRow key={it.id} item={it} last={i === group.length - 1} />
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function KnowledgeRow({ item, last }: { item: KnowledgeItem; last: boolean }) {
  const badge = TIER_BADGE[item.provenanceTier] ?? TIER_BADGE.founder_asserted;
  const hint = STORE_HINT[item.sourceStore] ?? item.sourceStore;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '9px 14px',
        borderBottom: last ? 'none' : '1px solid var(--line)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--ink-1)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={item.title}
        >
          {item.title}
        </div>
        {item.summary && (
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--ink-4)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.summary}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
        <Pill kind={badge.kind}>{badge.label}</Pill>
        <span className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-5)', letterSpacing: 0.2 }}>
          {hint}
        </span>
      </div>
    </div>
  );
}

function CenterNote({ text, tone = 'info' }: { text: string; tone?: 'info' | 'error' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 24px' }}>
      <p
        style={{
          fontSize: 12.5,
          color: tone === 'error' ? 'var(--clay)' : 'var(--ink-5)',
          textAlign: 'center',
          maxWidth: 420,
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        {text}
      </p>
    </div>
  );
}
