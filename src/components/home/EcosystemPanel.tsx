'use client';

/**
 * EcosystemPanel (changelog 17/06 item 14 — "Home → graph visuale"): the
 * ecosystem on Home is now the actual force-directed graph (read-only), so the
 * founder sees the startup ↔ competitors/personas/partners/investors web take
 * shape on the dashboard — not just counts. The textual/editable view lives on
 * /knowledge (item 14: "Home = visual, Knowledge = textual"). A compact legend
 * of type counts sits under the graph; apply/dismiss stays on /knowledge (the
 * graph here omits those handlers, so its detail drawer is read-only).
 */

import Link from 'next/link';
import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';
import { useKnowledgeGraph } from '@/hooks/useKnowledgeGraph';
import KnowledgeGraph from '@/components/graph/KnowledgeGraph';

// node_type → a founder-facing group label key. Unknown types fall back to "Other".
const TYPE_LABEL: Record<string, MessageKey> = {
  competitor: 'eco.competitors',
  market: 'eco.markets',
  persona: 'eco.personas',
  customer: 'eco.personas',
  partner: 'eco.partners',
  investor: 'eco.investors',
  funding: 'eco.investors',
  technology: 'eco.tech',
  risk: 'eco.risks',
  feature: 'eco.features',
  metric: 'eco.metrics',
  supplier: 'eco.suppliers',
  hr_collaborator: 'eco.hr-collabs',
  brand_asset: 'eco.branding',
  gtm_strategy: 'eco.gtm',
  business_essential: 'eco.business-essentials',
};

export function EcosystemPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const { graph } = useKnowledgeGraph(projectId);

  // `your_startup` is the implicit hub — every other node hangs off it, so it
  // doesn't earn a legend chip. Counts drive the legend under the graph.
  const ecoNodes = graph.nodes.filter((n) => n.node_type && n.node_type !== 'your_startup');
  const counts = new Map<MessageKey, number>();
  for (const n of ecoNodes) {
    const key = TYPE_LABEL[n.node_type as string] ?? 'eco.other';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const hasGraph = graph.nodes.length > 0;

  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-l)', overflow: 'hidden' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon d={I.layers} size={13} stroke={1.4} style={{ color: 'var(--ink-3)' }} />
        <h2 style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ink-3)' }}>
          {t('eco.title')}
        </h2>
        <Link
          href={`/project/${projectId}/knowledge`}
          style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)', textDecoration: 'none', fontFamily: 'var(--f-mono)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          {t('eco.view-graph')} <Icon d={I.arrow} size={10} stroke={1.4} />
        </Link>
      </header>

      {/* The visual graph — read-only on Home (no apply/dismiss handlers → the
          detail drawer renders without the Apply/Dismiss actions). Mounts only
          when there are nodes so an empty project doesn't spin up a d3 sim. */}
      {hasGraph ? (
        <div style={{ position: 'relative', height: 340, width: '100%' }}>
          <KnowledgeGraph nodes={graph.nodes} edges={graph.edges} />
        </div>
      ) : (
        <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--ink-5)', fontStyle: 'italic' }}>
          {t('eco.empty')}
        </div>
      )}

      {/* Compact legend — type counts double as quick links into /knowledge. */}
      {groups.length > 0 && (
        <div style={{ padding: 12, borderTop: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {groups.map(([key, n]) => (
            <Link
              key={key}
              href={`/project/${projectId}/knowledge`}
              style={{
                display: 'inline-flex', alignItems: 'baseline', gap: 6,
                padding: '6px 10px', borderRadius: 999,
                background: 'var(--paper-2)', border: '1px solid var(--line)',
                textDecoration: 'none', color: 'var(--ink-2)', fontSize: 12,
              }}
            >
              <span>{t(key)}</span>
              <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{n}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export default EcosystemPanel;
