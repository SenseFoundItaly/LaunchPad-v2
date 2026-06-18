'use client';

/**
 * CompetitorMatryoshka (changelog item 14): the textual competitor breakdown on
 * the Knowledge page — startup → competitor → category → detail. Each competitor
 * expands to its categories (general / product / pricing / distribution /
 * marketing / competitive advantage / criticality). Pending competitors show a
 * "pending" badge (they're reviewed here + in the graph, not the Inbox).
 *
 * Reads /competitors/breakdown; refetches on lp-knowledge-changed so approvals
 * elsewhere reflect here.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import { CATEGORY_LABEL_KEY, type CompetitorWithCategories } from '@/lib/competitor-categories';
import type { MessageKey } from '@/lib/i18n/messages';

export function CompetitorMatryoshka({ projectId }: { projectId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const { data } = useQuery<{ competitors: CompetitorWithCategories[] }>({
    queryKey: ['knowledge', projectId, 'competitors-breakdown'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/competitors/breakdown`);
      const body = await res.json();
      return (body?.data ?? body) as { competitors: CompetitorWithCategories[] };
    },
  });

  // Apply (0.5cr) / Dismiss a pending competitor right here — same PATCH the D3
  // graph uses — so the founder isn't forced into the graph to approve it.
  async function review(nodeId: string, state: 'applied' | 'rejected') {
    if (busy) return;
    setBusy(nodeId);
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) return;
      if (typeof window !== 'undefined') {
        if (state === 'applied') window.dispatchEvent(new CustomEvent('lp-credits-changed'));
        window.dispatchEvent(new CustomEvent('lp-knowledge-changed'));
      }
      void qc.invalidateQueries({ queryKey: ['knowledge', projectId] });
    } finally {
      setBusy(null);
    }
  }

  const competitors = data?.competitors ?? [];
  if (competitors.length === 0) return null; // nothing to show — stay out of the way

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-l)', overflow: 'hidden', margin: '12px 16px 0' }}>
      <header style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon d={I.layers} size={13} stroke={1.4} style={{ color: 'var(--ink-3)' }} />
        <h2 style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ink-3)' }}>
          {t('competitors.title')}
        </h2>
        <span className="lp-mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ink-5)' }}>{competitors.length}</span>
      </header>
      <div style={{ padding: 6, maxHeight: '38vh', overflowY: 'auto' }}>
        {competitors.map((c) => {
          const isOpen = expanded.has(c.id);
          const isPending = c.reviewed_state === 'pending';
          return (
            <div key={c.id} style={{ borderRadius: 6, overflow: 'hidden' }}>
              {/* Toggle + actions are SIBLINGS (no nested buttons). */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <button
                  onClick={() => toggle(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0,
                    border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--ink)', padding: 0,
                  }}
                >
                  <Icon d={isOpen ? I.chevd : I.chevr} size={12} stroke={1.5} style={{ color: 'var(--ink-5)', flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.name}
                  </span>
                  {c.categories.length > 0 && (
                    <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', flexShrink: 0 }}>
                      {t('competitors.category-count', { count: c.categories.length })}
                    </span>
                  )}
                </button>
                {isPending && (
                  <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => review(c.id, 'applied')}
                      disabled={busy === c.id}
                      className="lp-mono"
                      style={{ fontSize: 10, color: 'var(--on-accent)', background: 'var(--accent)', border: 'none', borderRadius: 999, padding: '2px 8px', cursor: busy === c.id ? 'default' : 'pointer', opacity: busy === c.id ? 0.6 : 1 }}
                    >
                      {t('competitors.apply')}
                    </button>
                    <button
                      onClick={() => review(c.id, 'rejected')}
                      disabled={busy === c.id}
                      className="lp-mono"
                      style={{ fontSize: 10, color: 'var(--ink-4)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 999, padding: '2px 8px', cursor: busy === c.id ? 'default' : 'pointer' }}
                    >
                      {t('competitors.dismiss')}
                    </button>
                  </span>
                )}
              </div>
              {isOpen && (
                <div style={{ padding: '0 10px 8px 30px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {c.categories.length === 0 ? (
                    <div style={{ fontSize: 11.5, color: 'var(--ink-5)', fontStyle: 'italic' }}>{t('competitors.no-categories')}</div>
                  ) : (
                    c.categories.map((cat) => (
                      <div key={cat.category}>
                        <div className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                          {t(CATEGORY_LABEL_KEY[cat.category] as MessageKey)}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>{cat.detail}</div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default CompetitorMatryoshka;
