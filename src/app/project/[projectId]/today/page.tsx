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
import { TopBar, NavRail } from '@/components/design/chrome';
import { Pill, StatusBar, Icon, I } from '@/components/design/primitives';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import { useProject } from '@/hooks/useProject';
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
// speak with one voice (Validated / In progress / Not started, EN + IT).
const STAGE_STATE: Record<StageEval['status'], { color: string; en: string; it: string }> = {
  done: { color: 'var(--moss)', en: 'Validated', it: 'Validato' },
  active: { color: 'var(--accent)', en: 'In progress', it: 'In corso' },
  pending: { color: 'var(--ink-5)', en: 'Not started', it: 'Da iniziare' },
};

// How many upcoming pending stages to preview after the active one, and the
// overall open-substep row cap that keeps Home a thin digest.
const NEXT_PENDING_STAGES = 2;
const MAX_OPEN_ROWS = 6;

export default function TodayPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);
  const { project } = useProject(projectId);
  const locale: 'en' | 'it' =
    (project as unknown as { locale?: string })?.locale === 'it' ? 'it' : 'en';

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

  return (
    <div className="lp-frame">
      <TopBar
        projectId={projectId}
        breadcrumb={['Project', 'Home']}
        right={
          <Pill kind={inboxBadge > 0 ? 'ok' : 'n'} dot={inboxBadge > 0}>
            {inboxBadge} pending
          </Pill>
        }
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="dashboard" inboxBadge={inboxBadge} />

        <div
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
              {greeting()}.
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-4)' }}>
              {summarize(inboxBadge, signalCount)}
            </p>
          </header>

          {actionsLoading && !actionsList ? (
            <SkeletonRow />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 880 }}>
              <StageCard projectId={projectId} />
              <NextToValidate projectId={projectId} locale={locale} />
              <Panel
                label="Watchers"
                icon={I.signal}
                href={`/project/${projectId}/actions?lane=monitor`}
                hrefLabel="Open Inbox"
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
                    {signalCount} signal{signalCount === 1 ? '' : 's'} awaiting review →
                  </Link>
                )}
              </Panel>
              <InboxPanel projectId={projectId} actions={actions} totalCount={inboxBadge} />
            </div>
          )}
        </div>
      </div>

      {/* No invented runtime state here — this page only knows pending actions
          (incl. signal rows), so the bar reports exactly that plus the
          watchers' documented weekly scan cadence. */}
      <StatusBar
        heartbeatLabel="watchers · weekly cadence"
        ctxLabel={`${signalCount} signal${signalCount === 1 ? '' : 's'} to review`}
        budget={`${inboxBadge} pending`}
      />
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
  const extra = Math.max(0, totalCount - actions.length);
  return (
    <Panel
      label="Inbox"
      icon={I.tickets}
      href={`/project/${projectId}/actions`}
      hrefLabel={totalCount > 0 ? `View all (${totalCount})` : 'Open inbox'}
      empty={actions.length === 0 ? 'No pending actions. Proposals from the co-pilot and your watchers land here.' : null}
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
          +{extra} more in inbox
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
function NextToValidate({ projectId, locale }: { projectId: string; locale: 'en' | 'it' }) {
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

  const title = locale === 'it' ? 'Da validare' : 'Next to validate';

  if (isLoading || !data) {
    return (
      <Panel label={title} icon={I.check} href={`/project/${projectId}/chat`} hrefLabel="Co-pilot" empty={null}>
        <div style={{ padding: '14px 12px', fontSize: 12, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)', textAlign: 'center' }}>
          {locale === 'it' ? 'Caricamento…' : 'Loading…'}
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
        hrefLabel="Co-pilot"
        empty={locale === 'it'
          ? 'Tutto validato. Niente da convalidare al momento.'
          : 'All validated. Nothing to validate right now.'}
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
      hrefLabel="Co-pilot"
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
                  {st[locale]}
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
                    {locale === 'it' ? 'pronto ad avanzare' : 'ready to advance'}
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
                      +{b.hiddenOpen} {locale === 'it' ? 'altri' : 'more'}
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
      Loading today…
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function summarize(inbox: number, signals: number): string {
  const bits: string[] = [];
  if (inbox > 0) bits.push(`${inbox} pending action${inbox === 1 ? '' : 's'}`);
  if (signals > 0) bits.push(`${signals} signal${signals === 1 ? '' : 's'} to review`);
  if (bits.length === 0) return 'Nothing pending right now.';
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
