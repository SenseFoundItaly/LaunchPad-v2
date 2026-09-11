'use client';

/**
 * MVP Architecture — changelog 05/09 item 13, plus item 7e's market sizing.
 *
 * "Bella la roadmap ma precoce che arrivi in fase di validazione soluzione …
 * integriamo una sezione 'MVP architecture' dove reindirizzare queste roadmap
 * tecniche + features, normative e tutto l'output dello stage 1B."
 *
 * It lives on the Knowledge page, not in the graph and not behind a new nav
 * entry. Two reasons, both the founder's own: the ad-hoc sections are "sempre
 * integrate alla knowledge", and the 2026-09-10 decision made the graph a
 * stakeholder map — a who, not a what. Stage-1B output is emphatically a what.
 *
 * Everything here is a READ of evidence the founder already approved (typed
 * memory_facts + research.market_size), so it can never disagree with the gate
 * and it needed no migration.
 *
 * Mirrors CompetitorMatryoshka: collapsible, remembered per project, and it
 * renders nothing at all when the project has no 1B output yet.
 */

import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';

interface MvpItem { id: string; text: string; created_at: string }
interface MvpSection { id: string; kind: string; items: MvpItem[] }
interface MvpResponse { sections: MvpSection[]; total: number; market_sizing: string | null }

const SECTION_LABEL: Record<string, MessageKey> = {
  feasibility: 'mvp.section-feasibility',
  risk: 'mvp.section-risk',
  dependencies: 'mvp.section-dependencies',
  regulatory: 'mvp.section-regulatory',
  ip: 'mvp.section-ip',
  data: 'mvp.section-data',
};

export function MvpArchitecturePanel({ projectId }: { projectId: string }) {
  const t = useT();
  const listId = useId();
  const storageKey = `lp_mvp_arch_open_${projectId}`;
  // Read storage in the INITIALISER, not an effect. Safe here specifically
  // because the panel renders null until its client query resolves, so the
  // server emits nothing for the first client paint to disagree with — and it
  // avoids the cascading-render the setState-in-effect rule warns about.
  const [open, setOpen] = useState<boolean>(() => {
    try {
      if (typeof window === 'undefined') return true;
      const saved = window.localStorage.getItem(storageKey);
      return saved === null ? true : saved === '1';
    } catch {
      return true; // private mode — open is the right default
    }
  });

  const { data } = useQuery<MvpResponse>({
    // Under the 'knowledge' prefix so the event bridge's lp-knowledge-changed
    // and lp-actions-changed both flush it — applying a 1B finding anywhere
    // refreshes this section without its own listener.
    queryKey: ['knowledge', projectId, 'mvp-architecture'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/mvp-architecture`);
      const body = await res.json();
      return (body?.data ?? body) as MvpResponse;
    },
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, open ? '1' : '0'); } catch { /* ignore */ }
  }, [storageKey, open]);

  const sections = (data?.sections ?? []).filter((s) => s.items.length > 0);
  const marketSizing = data?.market_sizing ?? null;
  // Nothing from 1B and no approved sizing — stay out of the way entirely
  // rather than render an empty promise (the founder has not got here yet).
  if (sections.length === 0 && !marketSizing) return null;

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
          {t('mvp.title')}
        </span>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
          {data?.total ?? 0}
        </span>
      </div>

      <div id={listId} hidden={!open} style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.45 }}>{t('mvp.subtitle')}</div>

        {/* Item 7e — the approved TAM/SAM/SOM, beside the technical picture
            rather than inside a graph node. Same source the gate reads. */}
        {marketSizing && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)' }}>
              {t('mvp.market-sizing')}
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{marketSizing}</span>
          </div>
        )}

        {sections.map((s) => (
          <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)' }}>
              {t(SECTION_LABEL[s.id] ?? 'mvp.title')}
            </div>
            {s.items.map((item) => (
              <div
                key={item.id}
                style={{ display: 'flex', gap: 7, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}
              >
                <Icon d={I.check} size={11} stroke={1.6} style={{ color: 'var(--moss)', flexShrink: 0, marginTop: 3 }} />
                {/* Full text, wrapped — never clipped. The knowledge list used
                    to cut findings twice (item 12) and the approval card once
                    (7g); a section whose whole purpose is holding 1B's output
                    must not repeat that. */}
                <span style={{ minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default MvpArchitecturePanel;
