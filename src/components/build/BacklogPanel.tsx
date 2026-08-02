'use client';

/**
 * Product backlog — the founder-facing render of what the co-pilot has heard.
 *
 * The intelligence loop's whole point is that scattered signals (chat remarks,
 * interview pains, watcher changes) become a deduped, feature-shaped plan. That
 * was invisible until this panel: without it the founder sees a preview change
 * and has to take on faith that anything was understood.
 *
 * Read-only by design (the Build tab renders; the chat acts) — every affordance
 * here points at the co-pilot or the Inbox.
 */

import { useT } from '@/components/providers/LocaleProvider';
import type { BuildIssue } from './types';

export default function BacklogPanel({
  issues,
  unclassifiedPending,
  openProposal,
  projectId,
}: {
  issues: BuildIssue[];
  unclassifiedPending: number;
  openProposal: { id: string; title: string } | null;
  projectId: string;
}) {
  const t = useT();

  const open = issues.filter((i) => i.status === 'open' || i.status === 'planned');
  const shipped = issues.filter((i) => i.shipped_in_iteration != null).slice(0, 6);

  // Group open issues by feature — the roadmap shape.
  const byFeature = new Map<string, BuildIssue[]>();
  for (const i of open) byFeature.set(i.feature, [...(byFeature.get(i.feature) ?? []), i]);

  const nothingYet = open.length === 0 && shipped.length === 0 && unclassifiedPending === 0;

  return (
    <section style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>
        {t('build.backlog.title')}
      </div>

      {/* A decision is waiting — the Build tab is where the founder is looking,
          so the handoff to the Inbox lives here (was: no cross-surface link). */}
      {openProposal && (
        <a href={`/project/${projectId}/actions`} style={proposalBanner}>
          <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>{openProposal.title}</span>
          <span style={{ fontSize: 11.5, color: 'var(--accent-ink, #6aa7ff)', whiteSpace: 'nowrap' }}>
            {t('build.proposal.review')} →
          </span>
        </a>
      )}

      {nothingYet ? (
        <p style={{ fontSize: 12.5, color: 'var(--ink-4)', margin: 0, lineHeight: 1.5 }}>
          {t('build.backlog.empty')}
        </p>
      ) : (
        <>
          {[...byFeature.entries()].map(([feature, list]) => (
            <div key={feature} style={{ marginBottom: 12 }}>
              <div style={featureLabel}>{feature}</div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {list.map((i) => (
                  <li key={i.id} style={row}>
                    <span style={{ fontSize: 12.5, color: 'var(--ink-2)', flex: 1, minWidth: 0 }}>{i.title}</span>
                    {i.severity === 'high' && <span style={sevPill}>{t('build.backlog.high')}</span>}
                    {i.evidence_count > 1 && (
                      <span style={{ fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
                        {t('build.backlog.evidence', { count: i.evidence_count })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {unclassifiedPending > 0 && (
            <p style={{ fontSize: 11.5, color: 'var(--ink-4)', margin: '0 0 12px' }}>
              {t('build.backlog.unsorted', { count: unclassifiedPending })}
            </p>
          )}

          {shipped.length > 0 && (
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 4 }}>
              <div style={featureLabel}>{t('build.backlog.shipped-title')}</div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {shipped.map((i) => (
                  <li key={i.id} style={{ ...row, opacity: 0.65 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--ink-3)', flex: 1, minWidth: 0 }}>{i.title}</span>
                    <span style={{ fontSize: 11, color: 'var(--moss, #6bbf7b)', whiteSpace: 'nowrap' }}>
                      {t('build.backlog.shipped-in', { version: i.shipped_in_iteration ?? 0 })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const card: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  padding: 18,
  background: 'var(--paper-2)',
  marginTop: 18,
};

const proposalBanner: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '9px 12px',
  marginBottom: 14,
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--surface, rgba(255,255,255,0.05))',
  textDecoration: 'none',
};

const featureLabel: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--ink-4)',
  marginBottom: 5,
};

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '3px 0',
};

const sevPill: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  padding: '1px 6px',
  borderRadius: 999,
  border: '1px solid var(--line)',
  color: 'var(--cat-rose, #d98a95)',
  whiteSpace: 'nowrap',
};
