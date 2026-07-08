'use client';

/**
 * Today — full-width project dashboard: "where am I + what needs me".
 *
 * Layout (full width, no narrow column):
 *   - Adaptive onboarding nudge + the Score strip (Project Score + IRL), pinned top.
 *   - A two-column grid (.lp-home-grid, collapses under ~900px):
 *       primary  → StageCard (the journey/validation card; its evidence checks
 *                  ARE the "next to validate" list — no separate panel duplicates it).
 *       secondary → Watchers (compact rows → Inbox), the Inbox preview, and Notes.
 *   - The Ecosystem graph spans full width below the grid.
 * A pending-signals line deep-links to the Signals lane. Everything reviews in
 * /actions — the unified Inbox is the canonical review surface.
 */

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSetChrome } from '@/components/design/chrome-context';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey, TranslateVars } from '@/lib/i18n/messages';
import { Icon, I } from '@/components/design/primitives';
import { PanelBoundary } from '@/components/design/PanelBoundary';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import { StageCard } from '@/components/stages/StageCard';
import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { NotesCard } from '@/components/onboarding/NotesCard';
import { ScorePanel } from '@/components/home/ScorePanel';
import { EcosystemPanel } from '@/components/home/EcosystemPanel';
import MonitorListPanel from '@/components/monitors/MonitorListPanel';
import { laneFor, isIntelInboxType } from '@/lib/action-lanes';
import type { PendingActionType } from '@/types';

// Mirror of the /actions Intel hide flag — keeps the Today "Intel" panel in
// lock-step with the full surface. See actions/page.tsx + action-lanes.ts.
const INTEL_HIDDEN = process.env.NEXT_PUBLIC_INTEL_HIDDEN === '1';

interface PendingAction {
  id: string;
  action_type: PendingActionType;
  title: string;
  created_at: string;
}

export default function TodayPage({ params }: { params: Promise<{ projectId: string }> }) {
  const t = useT();
  const { projectId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);

  // One list fetch covers both the inbox preview (top 3 rows) and the
  // pending-signals count (signal_alert rows live in pending_actions too).
  // Invalidates via the event bridge (lp-actions-changed → actions topic,
  // see src/lib/query-events.ts).
  const { data: actionsList, isLoading: actionsLoading } = useQuery<PendingAction[]>({
    queryKey: ['actions', projectId, 'preview'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/actions?status=pending,edited&limit=50`);
      const body = await res.json();
      if (!body.success || !Array.isArray(body.data?.actions)) return [];
      return body.data.actions as PendingAction[];
    },
  });

  const allPending = actionsList ?? [];
  // The Today "Intel" panel mirrors the /actions Intel inbox: WATCHER OUTPUT
  // only (signal_alert + intelligence_brief), so the preview never shows the
  // knowledge-proposal clutter the founder asked to drop for the alpha.
  const intelPending = allPending.filter((a) => isIntelInboxType(a.action_type));
  const actions = intelPending.slice(0, 3);
  const signalCount = allPending.filter((a) => laneFor(a.action_type) === 'signal').length;

  // Publish this page's chrome bits to the persistent layout (TopBar breadcrumb +
  // right pill, StatusBar). No invented runtime state here — this page only knows
  // pending actions (incl. signal rows), so the bar reports exactly that plus the
  // watchers' documented weekly scan cadence.
  // No TopBar `right` pill: the pending count is redundant with the Inbox
  // nav-rail badge, and its zero-state ("0 pending") was header noise the
  // founder asked to drop.
  useSetChrome(
    {
      breadcrumb: [t('today.breadcrumb-project'), t('today.breadcrumb-home')],
      status: {
        heartbeatLabel: t('today.watchers-cadence'),
        ctxLabel: t('today.signals-to-review', { count: signalCount }),
        budget: t('today.pending-count', { count: inboxBadge }),
      },
    },
    [inboxBadge, signalCount, t],
  );

  return (
    <div
      className="lp-rise"
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '24px 32px',
        background: 'var(--paper)',
      }}
    >
          <header style={{ marginBottom: 24 }}>
            <h1
              className="lp-serif"
              style={{ margin: 0, fontSize: 28, fontWeight: 400, letterSpacing: -0.6, lineHeight: 1.1 }}
            >
              {greeting(t)}.
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-4)' }}>
              {summarize(t, inboxBadge, signalCount)}
            </p>
          </header>

          {actionsLoading && !actionsList ? (
            <SkeletonRow />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Full-width: adaptive onboarding nudge + the score strip (pinned top).
                  Each panel is boundary-wrapped so one render throw degrades to a
                  muted card instead of taking down the whole dashboard. */}
              <PanelBoundary>
                <OnboardingCard projectId={projectId} />
              </PanelBoundary>
              <PanelBoundary>
                <ScorePanel projectId={projectId} />
              </PanelBoundary>

              {/* Two-column dashboard: wide Journey column + narrow utility column.
                  Collapses to one column under ~900px (.lp-home-grid). */}
              <div className="lp-home-grid">
                {/* Primary — the journey/validation card (its checks ARE the
                    "next to validate" list, so no separate panel duplicates it). */}
                <PanelBoundary>
                  <StageCard projectId={projectId} />
                </PanelBoundary>

                {/* Secondary — Watchers, Intel, Notes. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <Panel
                    dataTour="watchers-panel"
                    label={t('today.watchers')}
                    icon={I.signal}
                    href={`/project/${projectId}/actions?lane=monitor`}
                    hrefLabel={t('today.open-inbox')}
                    empty={null}
                  >
                    <MonitorListPanel projectId={projectId} compact limit={4} title="" />
                    {signalCount > 0 && (
                      <Link
                        href={`/project/${projectId}/actions?lane=signal`}
                        style={{
                          display: 'block',
                          padding: '6px 12px',
                          fontSize: 11,
                          color: 'var(--ink-4)',
                          textDecoration: 'none',
                          fontFamily: 'var(--f-mono)',
                          borderTop: '1px solid var(--line)',
                        }}
                      >
                        {t('today.signals-awaiting-review', { count: signalCount })}
                      </Link>
                    )}
                  </Panel>
                  {!INTEL_HIDDEN && (
                    <InboxPanel projectId={projectId} actions={actions} totalCount={intelPending.length} />
                  )}
                  <NotesCard projectId={projectId} />
                </div>
              </div>

              {/* Full-width: the ecosystem graph gets the whole width to breathe. */}
              <PanelBoundary>
                <EcosystemPanel projectId={projectId} />
              </PanelBoundary>
            </div>
          )}
    </div>
  );
}

// =============================================================================
// Panels
// =============================================================================

function InboxPanel({
  projectId,
  actions,
  totalCount,
}: {
  projectId: string;
  actions: PendingAction[];
  totalCount: number;
}) {
  const t = useT();
  const extra = Math.max(0, totalCount - actions.length);
  return (
    <Panel
      label={t('today.inbox')}
      icon={I.tickets}
      href={`/project/${projectId}/actions`}
      hrefLabel={totalCount > 0 ? t('today.view-all', { count: totalCount }) : t('today.open-inbox-lower')}
      empty={actions.length === 0 ? t('today.inbox-empty') : null}
    >
      {actions.map((a) => (
        <Link
          key={a.id}
          href={`/project/${projectId}/actions`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            borderRadius: 6,
            textDecoration: 'none',
            color: 'inherit',
            transition: 'background .1s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>
              {a.title}
            </div>
          </div>
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
            {humanAge(a.created_at)}
          </span>
        </Link>
      ))}
      {extra > 0 && (
        <Link
          href={`/project/${projectId}/actions`}
          style={{
            display: 'block',
            padding: '6px 12px',
            fontSize: 11,
            color: 'var(--ink-4)',
            textDecoration: 'none',
            fontFamily: 'var(--f-mono)',
          }}
        >
          {t('today.more-in-inbox', { count: extra })}
        </Link>
      )}
    </Panel>
  );
}

// =============================================================================
// Local primitives
// =============================================================================

function Panel({
  label,
  icon,
  href,
  hrefLabel,
  empty,
  children,
  dataTour,
}: {
  label: string;
  icon: string;
  href: string;
  hrefLabel: string;
  empty: string | null;
  children: React.ReactNode;
  /** Onboarding-walkthrough anchor (see tour-steps.ts). */
  dataTour?: string;
}) {
  return (
    <section
      data-tour={dataTour}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-l)',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Icon d={icon} size={13} stroke={1.4} style={{ color: 'var(--ink-3)' }} />
        <h2
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: 'var(--ink-3)',
          }}
        >
          {label}
        </h2>
        <div style={{ flex: 1 }} />
        <Link
          href={href}
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            textDecoration: 'none',
            fontFamily: 'var(--f-mono)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {hrefLabel}
          <Icon d={I.arrow} size={10} stroke={1.4} />
        </Link>
      </header>
      <div style={{ padding: 6 }}>
        {empty ? (
          <div
            style={{
              padding: '14px 12px',
              fontSize: 12,
              color: 'var(--ink-5)',
              textAlign: 'center',
              fontStyle: 'italic',
            }}
          >
            {empty}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function SkeletonRow() {
  const t = useT();
  return (
    <div
      style={{
        padding: 24,
        textAlign: 'center',
        fontSize: 12,
        color: 'var(--ink-5)',
        fontFamily: 'var(--f-mono)',
      }}
    >
      {t('today.loading-today')}
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

type TFn = (key: MessageKey, vars?: TranslateVars) => string;

function greeting(t: TFn): string {
  const h = new Date().getHours();
  if (h < 5) return t('today.greeting-late');
  if (h < 12) return t('today.greeting-morning');
  if (h < 18) return t('today.greeting-afternoon');
  return t('today.greeting-evening');
}

function summarize(t: TFn, inbox: number, signals: number): string {
  const bits: string[] = [];
  if (inbox > 0) bits.push(t('today.pending-actions', { count: inbox }));
  if (signals > 0) bits.push(t('today.signals-to-review', { count: signals }));
  if (bits.length === 0) return t('today.nothing-pending');
  return bits.join(' · ');
}

function humanAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
