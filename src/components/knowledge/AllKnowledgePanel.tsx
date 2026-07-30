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
import { useT } from '@/components/providers/LocaleProvider';
import { FilterTable, type FilterTone } from '@/components/ui/FilterTable';
import { ContextCards, type ContextSourceTone } from '@/components/ui/ContextCards';
import type { MessageKey } from '@/lib/i18n/messages';
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

/** Display order + label keys for the kind groups (resolved with `t` at render). */
const KIND_GROUPS: Array<{ kind: KnowledgeKind; labelKey: string; labelLowerKey: string }> = [
  { kind: 'entity', labelKey: 'kb.kind-entities', labelLowerKey: 'kb.kind-entities-lower' },
  { kind: 'competitor', labelKey: 'kb.kind-competitors', labelLowerKey: 'kb.kind-competitors-lower' },
  { kind: 'fact', labelKey: 'kb.kind-facts', labelLowerKey: 'kb.kind-facts-lower' },
  { kind: 'signal', labelKey: 'kb.kind-signals', labelLowerKey: 'kb.kind-signals-lower' },
  { kind: 'brief', labelKey: 'kb.kind-briefs', labelLowerKey: 'kb.kind-briefs-lower' },
  { kind: 'interview', labelKey: 'kb.kind-interviews', labelLowerKey: 'kb.kind-interviews-lower' },
];

/**
 * Per-kind section tint (Obsidian-style): a subtle diagonal wash fading to the
 * card surface, plus a solid colored left edge. Uses the existing design tokens
 * (src/styles/design-tokens.css) — `--<x>` solid + `--<x>-wash` light variant.
 * Colors echo the graph's NODE_COLORS where they overlap (competitor → clay).
 */
const KIND_TINT: Record<KnowledgeKind, { solid: string; wash: string }> = {
  entity:     { solid: 'var(--sky)',      wash: 'var(--sky-wash)' },
  competitor: { solid: 'var(--clay)',     wash: 'var(--clay-wash)' },
  fact:       { solid: 'var(--moss)',     wash: 'var(--moss-wash)' },
  signal:     { solid: 'var(--cat-gold)', wash: 'var(--cat-gold-wash)' },
  brief:      { solid: 'var(--plum)',     wash: 'var(--plum-wash)' },
  interview:  { solid: 'var(--cat-teal)', wash: 'var(--cat-teal-wash)' },
};

function sectionStyle(kind: KnowledgeKind) {
  const tint = KIND_TINT[kind];
  return {
    background: `linear-gradient(135deg, ${tint.wash} 0%, var(--surface) 70%)`,
    borderLeft: `3px solid ${tint.solid}`,
  };
}

/**
 * Same six tints, expressed as FilterTable tones — so the table view's chips
 * read as the same colour language as the sections' left edges. `interview`
 * has no cat-teal tone in the primitive's palette and falls back to neutral.
 */
const KIND_TONE: Record<KnowledgeKind, FilterTone> = {
  entity: 'sky',
  competitor: 'clay',
  fact: 'moss',
  signal: 'cat-gold',
  brief: 'plum',
  interview: 'neutral',
};

const TIER_BADGE: Record<ProvenanceTier, { labelKey: string; kind: 'n' | 'info' | 'ok' }> = {
  founder_asserted: { labelKey: 'kb.tier-founder-stated', kind: 'n' },
  workflow_derived: { labelKey: 'kb.tier-derived', kind: 'info' },
  externally_verified: { labelKey: 'kb.tier-verified', kind: 'ok' },
};

/**
 * Provenance tier → ContextCards source marker. The 2–4 char badge is the
 * founder-facing shorthand for who vouched for the item (you / the system / an
 * independent URL); the tone matches TIER_BADGE's neutral/info/ok reading.
 */
const TIER_SOURCE: Record<ProvenanceTier, { abbrKey: string; tone: ContextSourceTone }> = {
  founder_asserted: { abbrKey: 'ui.knowledge.tier-abbr-founder', tone: 'plum' },
  workflow_derived: { abbrKey: 'ui.knowledge.tier-abbr-derived', tone: 'sky' },
  externally_verified: { abbrKey: 'ui.knowledge.tier-abbr-verified', tone: 'moss' },
};

/** Founder-facing hint key for the producing store — detail view only. */
const STORE_HINT: Record<KnowledgeSourceStore, string> = {
  graph_nodes: 'kb.store-knowledge-graph',
  memory_facts: 'kb.store-saved-fact',
  ecosystem_alerts: 'kb.store-watcher-signal',
  intelligence_briefs: 'kb.store-intel-brief',
  competitor_profiles: 'kb.store-competitor-dossier',
  interviews: 'kb.store-interview-log',
};

/** Short founder-facing "when" stamp: today / yesterday / 5d ago / Mar 5. */
function relTime(iso: string, t: ReturnType<typeof useT>): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return t('kb.time-today');
  if (days === 1) return t('kb.time-yesterday');
  if (days < 7) return t('kb.time-days-ago', { n: days });
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}

export default function AllKnowledgePanel({ projectId }: { projectId: string }) {
  const t = useT();
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
  // Sections = the tinted per-kind panels with expandable row detail (default,
  // and the only view that carries the detail). Table = the same rows in one
  // FilterTable, filterable by kind. Additive: the toggle never removes the
  // sections view, because the table has no row expansion to put detail in.
  const [layout, setLayout] = useState<'sections' | 'table'>('sections');

  if (isLoading) return <CenterNote text={t('kb.loading-project-knowledge')} />;
  if (errorMsg) return <CenterNote text={t('kb.load-knowledge-error', { error: errorMsg })} tone="error" />;
  if (data.summary.total === 0) {
    return (
      <CenterNote text={t('kb.all-empty')} />
    );
  }

  const { items, summary } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Summary chips — counts by kind, then the provenance split. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Pill kind="live" dot>
          {summary.total === 1
            ? t('kb.item-count-one', { count: summary.total })
            : t('kb.item-count-many', { count: summary.total })}
        </Pill>
        {KIND_GROUPS.filter(g => summary.byKind[g.kind] > 0).map(g => (
          <Pill key={g.kind} kind="n">{summary.byKind[g.kind]} {t(g.labelLowerKey as MessageKey)}</Pill>
        ))}
        <span style={{ width: 1, height: 14, background: 'var(--line)', margin: '0 4px' }} />
        {(Object.keys(TIER_BADGE) as ProvenanceTier[])
          .filter(tier => summary.byProvenanceTier[tier] > 0)
          .map(tier => (
            <Pill key={tier} kind={TIER_BADGE[tier].kind} dot>
              {summary.byProvenanceTier[tier]} {t(TIER_BADGE[tier].labelKey as MessageKey)}
            </Pill>
          ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          {(['sections', 'table'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setLayout(mode)}
              aria-pressed={layout === mode}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 9px',
                borderRadius: 'var(--r-s)',
                border: '1px solid var(--line)',
                cursor: 'pointer',
                background: layout === mode ? 'var(--ink)' : 'transparent',
                color: layout === mode ? 'var(--paper)' : 'var(--ink-4)',
              }}
            >
              {t(mode === 'sections' ? 'ui.knowledge.view-sections' : 'ui.knowledge.view-table')}
            </button>
          ))}
        </div>
      </div>

      {layout === 'table' ? (
        <FilterTable
          minWidth={400}
          columns={[
            { key: 'title', label: t('ui.knowledge.col-item'), width: '1.35fr' },
            { key: 'tier', label: t('ui.knowledge.col-provenance'), width: '0.85fr' },
            { key: 'kind', label: t('ui.knowledge.col-kind'), width: '88px', status: true },
          ]}
          // Only kinds actually present get a chip — an option with no rows
          // would render a chip permanently reading 0.
          options={KIND_GROUPS.filter(g => items.some(it => it.kind === g.kind)).map(g => ({
            key: g.kind,
            label: t(g.labelKey as MessageKey),
            dot: KIND_TINT[g.kind].solid,
            tone: KIND_TONE[g.kind],
          }))}
          rows={items.map(it => ({
            id: it.id,
            status: it.kind,
            cells: {
              title: it.title,
              tier: t((TIER_BADGE[it.provenanceTier] ?? TIER_BADGE.founder_asserted).labelKey as MessageKey),
            },
          }))}
        />
      ) : (
        KIND_GROUPS.map(({ kind, labelKey }) => {
          const group = items.filter(it => it.kind === kind);
          if (group.length === 0) return null;
          return (
            <Panel key={kind} title={t(labelKey as MessageKey)} subtitle={`${group.length}`} style={sectionStyle(kind)}>
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
        })
      )}
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
  const t = useT();
  const badge = TIER_BADGE[item.provenanceTier] ?? TIER_BADGE.founder_asserted;
  const source = TIER_SOURCE[item.provenanceTier] ?? TIER_SOURCE.founder_asserted;
  const hintKey = STORE_HINT[item.sourceStore];
  const hint = hintKey ? t(hintKey as MessageKey) : item.sourceStore;
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
        <Pill kind={badge.kind}>{t(badge.labelKey as MessageKey)}</Pill>
        <span
          className="lp-mono"
          style={{ fontSize: 10, color: 'var(--ink-5)', flexShrink: 0 }}
        >
          {relTime(item.createdAt, t)}
        </span>
        <RowChevron open={expanded} />
      </div>

      {/* Detail — the item rendered as one attributed chunk. Everything the
          hand-rolled detail carried survives: the summary is the chunk body,
          the exact timestamp is its meta, and the producing store + provenance
          tier + source URL are the attribution chip (a link when the ref is a
          real URL, inert otherwise — the chip never fakes being clickable). */}
      {expanded && (
        <div style={{ padding: '2px 14px 12px' }}>
          <ContextCards
            heading={t('ui.knowledge.detail-heading')}
            chunks={[{
              id: item.id,
              title: item.title,
              meta: new Date(item.createdAt).toLocaleString(),
              body: item.summary || t('ui.knowledge.no-summary'),
              source: {
                label: hint,
                badge: t(source.abbrKey as MessageKey),
                tone: source.tone,
                ...(refIsUrl ? { href: item.sourceRef as string } : {}),
              },
            }]}
          />
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
