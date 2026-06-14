'use client';

/**
 * Today — thin digest: "where am I + what needs me". Nothing more.
 *
 * Three panels: journey position (StageCard), Watchers (compact rows that
 * deep-link into the Inbox's Watchers tab), and the Inbox preview (top
 * pending rows + count). A pending-signals line deep-links to the Signals
 * lane. Everything reviews in /actions — the unified Inbox is the canonical
 * review surface.
 */

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSetChrome } from '@/components/design/chrome-context';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey, TranslateVars } from '@/lib/i18n/messages';
import { Pill, Icon, I } from '@/components/design/primitives';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import { StageCard } from '@/components/stages/StageCard';
import MonitorListPanel from '@/components/monitors/MonitorListPanel';
import { laneFor } from '@/lib/action-lanes';
import type { PendingActionType } from '@/types';

interface PendingAction {
  id: string;
  action_type: PendingActionType;
  title: string;
  created_at: string;
}

// Mirrors the /stages payload (same shape StageCard + SpineSection read).
interface StageCheckRow {
  check: { id: string; label: string };
  result: { passed: boolean; evidence?: string; gap?: string };
}
interface StageEval {
  stage: { id: string; number: number; label: string; tagline?: string };
  passed: number;
  total: number;
  status: 'done' | 'active' | 'pending';
  results: StageCheckRow[];
}
interface StagesPayload {
  active_stage_id: string;
  active_stage_number: number;
  evaluations: StageEval[];
}

// State labels reused verbatim from SpineSection so Home and the chat spine
// speak with one voice (Validated / In progress / Not started). Each carries a
// stable i18n key resolved via t() at the render site (mirrors NavRail's
// labelKey pattern).
const STAGE_STATE: Record<StageEval['status'], { color: string; labelKey: MessageKey }> = {
  done: { color: 'var(--moss)', labelKey: 'today.state-validated' },
  active: { color: 'var(--accent)', labelKey: 'today.state-in-progress' },
  pending: { color: 'var(--ink-5)', labelKey: 'today.state-not-started' },
};

// How many upcoming pending stages to preview after the active one, and the
// overall open-substep row cap that keeps Home a thin digest.
const NEXT_PENDING_STAGES = 2;
const MAX_OPEN_ROWS = 6;

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
  const actions = allPending.slice(0, 3);
  const signalCount = allPending.filter((a) => laneFor(a.action_type) === 'signal').length;

  // Publish this page's chrome bits to the persistent layout (TopBar breadcrumb +
  // right pill, StatusBar). No invented runtime state here — this page only knows
  // pending actions (incl. signal rows), so the bar reports exactly that plus the
  // watchers' documented weekly scan cadence.
  useSetChrome(
    {
      breadcrumb: [t('today.breadcrumb-project'), t('today.breadcrumb-home')],
      right: (
        <Pill kind={inboxBadge > 0 ? 'ok' : 'n'} dot={inboxBadge > 0}>
          {t('today.pending-count', { count: inboxBadge })}
        </Pill>
      ),
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 880 }}>
              <StageCard projectId={projectId} />
              <NextToValidate projectId={projectId} />
              <Panel
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
              <InboxPanel projectId={projectId} actions={actions} totalCount={inboxBadge} />
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
// Next to validate
// =============================================================================

/**
 * Companion to StageCard: keeps the current stage status (above) AND shows
 * what still needs validating next. Lists the ACTIVE stage plus the next 1-2
 * PENDING stages (by stage.number), each with its OPEN substeps only
 * (results where result.passed === false) rendered "○ {label} — {gap}".
 * Validated stages are not listed — they're done. Total rows are capped so
 * Home stays a thin digest. Reuses the SpineSection ✓/○ treatment + STATE
 * labels for one consistent validation voice across surfaces.
 */
function NextToValidate({ projectId }: { projectId: string }) {
  const t = useT();
  const { data, isLoading } = useQuery<StagesPayload>({
    queryKey: ['stages', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/stages`);
      const body = await res.json();
      if (!body.success) throw new Error(body.error || 'Stages fetch failed');
      return body.data as StagesPayload;
    },
  });

  const title = t('today.next-to-validate');

  if (isLoading || !data) {
    return (
      <Panel label={title} icon={I.check} href={`/project/${projectId}/chat`} hrefLabel={t('today.copilot')} empty={null}>
        <div style={{ padding: '14px 12px', fontSize: 12, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)', textAlign: 'center' }}>
          {t('common.loading')}
        </div>
      </Panel>
    );
  }

  const evals = [...data.evaluations].sort((a, b) => a.stage.number - b.stage.number);
  const active = evals.find((e) => e.status === 'active') ?? null;
  // The active stage, then the next 1-2 pending stages by number — never any
  // validated (done) stage.
  const upcoming = evals.filter((e) => e.status === 'pending').slice(0, NEXT_PENDING_STAGES);
  const lanes = (active ? [active, ...upcoming] : upcoming);

  // Build capped rows: each lane contributes its open substeps; an active
  // lane with zero open substeps surfaces a "ready to advance" line instead.
  let budget = MAX_OPEN_ROWS;
  const blocks = lanes
    .map((e) => {
      const open = e.results.filter((r) => !r.result.passed);
      const rows = open.slice(0, budget);
      budget -= rows.length;
      const readyToAdvance = e.status === 'active' && open.length === 0;
      return { stage: e, status: e.status, rows, hiddenOpen: open.length - rows.length, readyToAdvance };
    })
    // Drop pending lanes that contributed nothing once the budget ran out
    // (keep the active lane even if empty so "ready to advance" can show).
    .filter((b) => b.rows.length > 0 || b.readyToAdvance);

  if (blocks.length === 0) {
    return (
      <Panel
        label={title}
        icon={I.check}
        href={`/project/${projectId}/chat`}
        hrefLabel={t('today.copilot')}
        empty={t('today.all-validated')}
      >
        {null}
      </Panel>
    );
  }

  return (
    <Panel
      label={title}
      icon={I.check}
      href={`/project/${projectId}/chat`}
      hrefLabel={t('today.copilot')}
      empty={null}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 8px 6px' }}>
        {blocks.map((b) => {
          const st = STAGE_STATE[b.status];
          return (
            <div key={b.stage.stage.id}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', letterSpacing: 0.3 }}>
                  {String(b.stage.stage.number).padStart(2, '0')}
                </span>
                <span className="lp-serif" style={{ fontSize: 12.5, color: 'var(--ink)' }}>
                  {b.stage.stage.label}
                </span>
                <span className="lp-mono" style={{ fontSize: 9, color: st.color, letterSpacing: 0.3 }}>
                  {t(st.labelKey)}
                </span>
              </div>
              {b.readyToAdvance ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 23 }}>
                  {b.stage.stage.tagline && (
                    <div style={{ fontSize: 11, color: 'var(--ink-5)', lineHeight: 1.4 }}>
                      {b.stage.stage.tagline}
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, color: 'var(--moss)' }}>
                    {t('today.ready-to-advance')}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 23 }}>
                  {b.rows.map((r, i) => (
                    <div key={r.check.id || i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, lineHeight: 1.4 }}>
                      <span
                        aria-hidden
                        style={{
                          width: 15, height: 15, borderRadius: 8, flexShrink: 0, marginTop: 1,
                          background: 'transparent',
                          border: '1.5px solid var(--line-2)',
                        }}
                      />
                      <span style={{ color: 'var(--ink-3)' }}>
                        {r.check.label}
                        {r.result.gap && <span style={{ color: 'var(--ink-5)' }}> — {r.result.gap}</span>}
                      </span>
                    </div>
                  ))}
                  {b.hiddenOpen > 0 && (
                    <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', paddingLeft: 23 }}>
                      {t('today.more-open', { count: b.hiddenOpen })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
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
}: {
  label: string;
  icon: string;
  href: string;
  hrefLabel: string;
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <section
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
