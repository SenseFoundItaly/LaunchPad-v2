'use client';

/**
 * StageCard — Home/Dashboard hero panel showing the active stage with
 * per-check evidence + gaps. Past stages collapse to a one-line ✓. Future
 * stages render as a thin teaser strip below.
 *
 * Reads from GET /api/projects/[id]/stages via react-query.
 */

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Panel, Pill, Icon, I } from '@/components/design/primitives';

interface CheckResult {
  passed: boolean;
  evidence?: string;
  gap?: string;
}
interface CheckRow {
  check: { id: string; label: string; source: string };
  result: CheckResult;
}
interface StageEvaluation {
  stage: {
    id: string;
    number: number;
    label: string;
    tagline: string;
  };
  passed: number;
  total: number;
  status: 'done' | 'active' | 'pending';
  results: CheckRow[];
}
interface StagesPayload {
  active_stage_id: string;
  active_stage_number: number;
  evaluations: StageEvaluation[];
}

export function StageCard({ projectId }: { projectId: string }) {
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

  if (isLoading || !data) {
    return <div className="lp-card" style={{ height: 220, opacity: 0.5 }} />;
  }

  const active = data.evaluations.find((e) => e.status === 'active');
  const done = data.evaluations.filter((e) => e.status === 'done');
  const pending = data.evaluations.filter((e) => e.status === 'pending');

  // Edge case: everything done → show the last stage as a "all clear" card.
  const headline = active ?? data.evaluations[data.evaluations.length - 1];

  // Time-gated detection: some checks can't be closed by founder action right
  // now — they need watchers/monitors to accumulate signals over time
  // (segment_signals, or any gap that says "let monitors run"). When EVERY
  // open gap on the active stage is time-gated, "go talk to the Co-pilot"
  // is the wrong CTA — waiting is the action.
  const openGaps = active ? active.results.filter((r) => !r.result.passed) : [];
  const onlyTimeGatedGaps =
    openGaps.length > 0 &&
    openGaps.every(
      (r) => r.check.id === 'segment_signals' || /let monitors run/i.test(r.result.gap ?? ''),
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Past stages — compact strip */}
      {done.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {done.map((e) => (
            <DoneChip key={e.stage.id} number={e.stage.number} label={e.stage.label} />
          ))}
        </div>
      )}

      {/* Active stage hero */}
      <Panel
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', letterSpacing: 0.5 }}>
              STAGE {headline.stage.number}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{headline.stage.label}</span>
          </span>
        }
        subtitle={headline.stage.tagline}
        right={
          <Pill kind={headline.status === 'done' ? 'ok' : 'live'} dot={headline.status === 'active'}>
            Evidence: {headline.passed} of {headline.total} checks
          </Pill>
        }
      >
        <div style={{ padding: '4px 0' }}>
          {headline.results.map(({ check, result }) => (
            <CheckRowView key={check.id} check={check} result={result} />
          ))}
        </div>
        {active && active.passed < active.total && (
          <div style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--line)',
            background: 'var(--paper-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', flex: 1 }}>
              {onlyTimeGatedGaps
                ? 'Monitors running — check back after the next weekly scan.'
                : 'Next: address the gaps above with the Co-pilot.'}
            </span>
            <Link href={`/project/${projectId}/chat`} style={ctaStyle}>
              Open Co-pilot →
            </Link>
          </div>
        )}
      </Panel>

      {/* Future stages — thin preview */}
      {pending.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', opacity: 0.6 }}>
          {pending.map((e) => (
            <PendingChip key={e.stage.id} number={e.stage.number} label={e.stage.label} />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckRowView({ check, result }: { check: CheckRow['check']; result: CheckResult }) {
  return (
    <div style={{
      padding: '10px 14px',
      borderTop: '1px solid var(--line)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }}>
      <span style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        background: result.passed ? 'var(--moss)' : 'transparent',
        border: `1px solid ${result.passed ? 'var(--moss)' : 'var(--line-2)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {result.passed && (
          <Icon d={I.check} size={10} stroke={2} style={{ color: 'var(--paper)' }} />
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: result.passed ? 'var(--ink)' : 'var(--ink-3)' }}>
          {check.label}
        </div>
        {(result.evidence || result.gap) && (
          <div className="lp-mono" style={{
            fontSize: 10.5,
            color: result.passed ? 'var(--moss)' : 'var(--clay)',
            marginTop: 2,
            letterSpacing: 0.2,
          }}>
            {result.evidence ?? result.gap}
          </div>
        )}
      </div>
      <span className="lp-mono" style={{
        fontSize: 9.5,
        color: 'var(--ink-5)',
        letterSpacing: 0.3,
        flexShrink: 0,
      }}>
        {check.source}
      </span>
    </div>
  );
}

function DoneChip({ number, label }: { number: number; label: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 8px',
      borderRadius: 999,
      background: 'var(--moss-wash)',
      color: 'var(--moss)',
      fontSize: 10.5,
      fontWeight: 500,
    }}>
      <Icon d={I.check} size={9} stroke={2.2} />
      <span className="lp-mono" style={{ letterSpacing: 0.3 }}>{number}</span>
      {label}
    </span>
  );
}

function PendingChip({ number, label }: { number: number; label: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 8px',
      borderRadius: 999,
      background: 'var(--paper-2)',
      color: 'var(--ink-5)',
      fontSize: 10.5,
      fontWeight: 400,
      border: '1px solid var(--line-2)',
    }}>
      <span className="lp-mono" style={{ letterSpacing: 0.3 }}>{number}</span>
      {label}
    </span>
  );
}

const ctaStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '5px 10px',
  background: 'var(--ink)',
  color: 'var(--paper)',
  borderRadius: 6,
  textDecoration: 'none',
  fontSize: 11.5,
  fontWeight: 500,
};
