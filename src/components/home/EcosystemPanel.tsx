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
import { useLocale, useT } from '@/components/providers/LocaleProvider';
import { useKnowledgeGraph } from '@/hooks/useKnowledgeGraph';
import KnowledgeGraph from '@/components/graph/KnowledgeGraph';
import type { MacroCategory } from '@/types/graph';
import { macroCategoryFor, MACRO_CATEGORY_ORDER, MACRO_CATEGORY_LABEL, MACRO_CATEGORY_COLOR } from '@/types/graph';

export function EcosystemPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const locale = useLocale();
  const { graph } = useKnowledgeGraph(projectId);

  // `your_startup` is the implicit hub — every other node hangs off it, so it
  // doesn't earn a legend chip. Counts collapse into the same 12-satellite
  // macro-categories the graph draws (macroCategoryFor), so the legend under
  // the graph names the SAME wedges the founder sees above it; chips deep-link
  // into /knowledge?cat= (the graph opens drilled into that satellite).
  const counts = new Map<MacroCategory, number>();
  for (const n of graph.nodes) {
    if (!n.node_type || n.node_type === 'your_startup') continue;
    const cat = macroCategoryFor(n.node_type);
    if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  // Fixed wedge order (same clock positions as the graph), present categories only.
  const groups = MACRO_CATEGORY_ORDER.filter((cat) => counts.has(cat))
    .map((cat) => [cat, counts.get(cat) as number] as const);
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

      {/* Compact legend — macro-category counts double as deep links into the
          /knowledge graph, pre-drilled into that satellite (?cat=). */}
      {groups.length > 0 && (
        <div style={{ padding: 12, borderTop: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {groups.map(([cat, n]) => (
            <Link
              key={cat}
              href={`/project/${projectId}/knowledge?cat=${cat}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 999,
                background: 'var(--paper-2)', border: '1px solid var(--line)',
                textDecoration: 'none', color: 'var(--ink-2)', fontSize: 12,
              }}
            >
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: MACRO_CATEGORY_COLOR[cat], flexShrink: 0 }} />
              <span>{MACRO_CATEGORY_LABEL[cat][locale === 'it' ? 'it' : 'en']}</span>
              <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{n}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export default EcosystemPanel;
