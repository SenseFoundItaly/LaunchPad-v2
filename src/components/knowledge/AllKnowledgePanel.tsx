'use client';

/**
 * AllKnowledgePanel — the default view of the Knowledge page's "All" tab.
 *
 * Renders the unified knowledge read-layer
 * (GET /api/projects/[id]/knowledge/unified): every live item across the
 * fragmented stores (graph_nodes, memory_facts, ecosystem_alerts,
 * intelligence_briefs, competitor_profiles, interviews) as ONE provenance-
 * tagged list — header chips from the summary, items grouped by kind.
 *
 * Field diet: the default row is just *what it is + provenance chip + when*.
 * Summaries, source-store labels, exact timestamps, and source links live in
 * the expanded detail (click a row).
 *
 * Provenance badge language is founder-facing, not schema-facing:
 *   founder_asserted    → "founder-stated" (muted — your own claim)
 *   workflow_derived    → "derived"        (the system produced it)
 *   externally_verified → "verified"       (an independent URL backs it)
 */

import { useState } from 'react';
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
  founder_asserted: { label: 'founder-stated', kind: 'n' },
  workflow_derived: { label: 'derived', kind: 'info' },
  externally_verified: { label: 'verified', kind: 'ok' },
};

/** Founder-facing hint for the producing store — detail view only. */
const STORE_HINT: Record<KnowledgeSourceStore, string> = {
  graph_nodes: 'knowledge graph',
  memory_facts: 'saved fact',
  ecosystem_alerts: 'watcher signal',
  intelligence_briefs: 'intel brief',
  competitor_profiles: 'competitor dossier',
  interviews: 'interview log',
};

/** Short founder-facing "when" stamp: today / yesterday / 5d ago / Mar 5. */
function relTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}

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

  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) return <CenterNote text="Loading project knowledge…" />;
  if (errorMsg) return <CenterNote text={`Couldn’t load knowledge: ${errorMsg}`} tone="error" />;
  if (data.summary.total === 0) {
    return (
      <CenterNote text="Nothing here yet. Chat with the agent, approve proposals under “Needs review”, or let watchers land signals — everything the project learns shows up here." />
    );
  }

  const { items, summary } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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
                <KnowledgeRow
                  key={it.id}
                  item={it}
                  last={i === group.length - 1}
                  expanded={expandedId === it.id}
                  onToggle={() => setExpandedId(expandedId === it.id ? null : it.id)}
                />
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function RowChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{ transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none', flexShrink: 0, color: 'var(--ink-5)' }}
    >
      <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KnowledgeRow({
  item,
  last,
  expanded,
  onToggle,
}: {
  item: KnowledgeItem;
  last: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const badge = TIER_BADGE[item.provenanceTier] ?? TIER_BADGE.founder_asserted;
  const hint = STORE_HINT[item.sourceStore] ?? item.sourceStore;
  const refIsUrl = !!item.sourceRef && /^https?:\/\//i.test(item.sourceRef);

  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid var(--line)' }}>
      {/* Default row — what it is + provenance chip + when. Everything else
          (summary, source store, exact timestamp, link) is in the detail. */}
      <div
        onClick={onToggle}
        role="button"
        aria-expanded={expanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '9px 14px',
          cursor: 'pointer',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--paper-2)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
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
        <Pill kind={badge.kind}>{badge.label}</Pill>
        <span
          className="lp-mono"
          style={{ fontSize: 10, color: 'var(--ink-5)', flexShrink: 0 }}
        >
          {relTime(item.createdAt)}
        </span>
        <RowChevron open={expanded} />
      </div>

      {expanded && (
        <div style={{ padding: '0 14px 10px' }}>
          {item.summary && (
            <p style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5, margin: '6px 0 8px' }}>
              {item.summary}
            </p>
          )}
          <div
            className="lp-mono"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 10,
              color: 'var(--ink-5)',
            }}
          >
            <span>from {hint}</span>
            <span>{new Date(item.createdAt).toLocaleString()}</span>
            {refIsUrl && (
              <a
                href={item.sourceRef as string}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ color: 'var(--accent-ink, var(--accent))', textDecoration: 'underline', textUnderlineOffset: 2 }}
              >
                source ↗
              </a>
            )}
          </div>
        </div>
      )}
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
