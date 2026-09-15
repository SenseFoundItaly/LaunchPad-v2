'use client';

/**
 * Knowledge topics — Go to market, market trends, tech trends, brainstorming.
 *
 * The rest of the 05/09 proposta's "sezioni ad hoc … sempre integrate alla
 * knowledge" (MVP architecture has its own panel above). One panel with a tab
 * per topic rather than four more collapsibles: the founder's complaint was
 * clutter, and a stack of headers above the graph is exactly that. A topic with
 * no approved evidence gets no tab; a project with none renders nothing.
 *
 * Same contract as MvpArchitecturePanel: a read of approved evidence only,
 * collapsible and remembered per project, never clips text.
 */

import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';
import type { KnowledgeTopicId, KnowledgeTopicsResponse } from '@/lib/knowledge-topics';

const TOPIC_LABEL: Record<KnowledgeTopicId, MessageKey> = {
  gtm: 'topics.section-gtm',
  market_trends: 'topics.section-market-trends',
  tech_trends: 'topics.section-tech-trends',
  brainstorming: 'topics.section-brainstorming',
};

export function KnowledgeTopicsPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const listId = useId();
  const storageKey = `lp_knowledge_topics_open_${projectId}`;
  // Read storage in the INITIALISER, not an effect (React Compiler flags
  // setState-in-effect). Safe because the panel renders null until its client
  // query resolves, so there is no server paint to disagree with.
  const [open, setOpen] = useState<boolean>(() => {
    try {
      if (typeof window === 'undefined') return true;
      const saved = window.localStorage.getItem(storageKey);
      return saved === null ? true : saved === '1';
    } catch {
      return true; // private mode — open is the right default
    }
  });
  // The founder's explicit tab choice. null = "the first topic with evidence",
  // derived at render so a late-arriving query never needs an effect to fix it.
  const [selected, setSelected] = useState<KnowledgeTopicId | null>(null);

  const { data } = useQuery<KnowledgeTopicsResponse>({
    // Under the 'knowledge' prefix so the event bridge's lp-knowledge-changed
    // and lp-actions-changed flush it — approving a GTM card or saving a note
    // anywhere refreshes this panel without its own listener.
    queryKey: ['knowledge', projectId, 'topics'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/knowledge-topics`);
      const body = await res.json();
      return (body?.data ?? body) as KnowledgeTopicsResponse;
    },
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, open ? '1' : '0'); } catch { /* ignore */ }
  }, [storageKey, open]);

  const sections = (data?.sections ?? []).filter((s) => s.items.length > 0);
  // No approved evidence for any topic yet — stay out of the way entirely.
  if (sections.length === 0) return null;

  const active = sections.find((s) => s.id === selected) ?? sections[0];

  return (
    <div style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', cursor: 'pointer' }}
      >
        <span aria-hidden style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', color: 'var(--ink-5)', fontSize: 12 }}>›</span>
        <span className="lp-mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          {t('topics.title')}
        </span>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
          {data?.total ?? 0}
        </span>
      </div>

      <div id={listId} hidden={!open} style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.45 }}>{t('topics.subtitle')}</div>

        <div role="tablist" aria-label={t('topics.title')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {sections.map((s) => {
            const isActive = s.id === active.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setSelected(s.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  borderRadius: 'var(--r-m)',
                  border: '1px solid var(--line)',
                  // --paper is the true inverse of --ink in both themes.
                  background: isActive ? 'var(--ink)' : 'transparent',
                  color: isActive ? 'var(--paper)' : 'var(--ink-4)',
                }}
              >
                {t(TOPIC_LABEL[s.id])}
                <span className="lp-mono" style={{ fontSize: 10, opacity: 0.75 }}>{s.items.length}</span>
              </button>
            );
          })}
        </div>

        <div role="tabpanel" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {active.items.map((item) => (
            <div key={item.id} style={{ display: 'flex', gap: 7, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>
              <Icon d={I.check} size={11} stroke={1.6} style={{ color: 'var(--moss)', flexShrink: 0, marginTop: 3 }} />
              {/* Full text, wrapped — never clipped (items 12 and 7g). */}
              <span style={{ minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {item.title && <strong style={{ fontWeight: 600, color: 'var(--ink)' }}>{item.title}</strong>}
                {item.title && item.text && ' — '}
                {item.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default KnowledgeTopicsPanel;
