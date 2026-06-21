'use client';

/**
 * EcosystemPanel (changelog 17/06 item 14 / "Home → visual graph"): a compact
 * ecosystem readout on Home — entity counts grouped by type (competitors,
 * personas, partners, investors, …) with a link into the full force-directed
 * graph on /knowledge. A full inline mini-graph on Home is the polish follow-up
 * (it pairs with the WS6 graph/competitor-categories work); this gives Home a
 * real ecosystem presence today without a heavy embed.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';

interface GraphResp { nodes: Array<{ node_type?: string }>; }

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
};

export function EcosystemPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const { data } = useQuery<GraphResp>({
    queryKey: ['knowledge', projectId, 'eco'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/graph/${projectId}`);
      const body = await res.json();
      return (body?.data ?? body) as GraphResp;
    },
  });

  const nodes = (data?.nodes ?? []).filter((n) => n.node_type && n.node_type !== 'your_startup');
  const counts = new Map<MessageKey, number>();
  for (const n of nodes) {
    const key = TYPE_LABEL[n.node_type as string] ?? 'eco.other';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1]);

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
      <div style={{ padding: groups.length === 0 ? '14px 16px' : 12 }}>
        {groups.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-5)', fontStyle: 'italic' }}>{t('eco.empty')}</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
      </div>
    </section>
  );
}

export default EcosystemPanel;
