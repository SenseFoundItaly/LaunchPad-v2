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
import { checkActionPrompt } from '@/lib/journey-prompts';
import { useT } from '@/components/providers/LocaleProvider';

interface CheckResult {
  passed: boolean;
  evidence?: string;
  gap?: string;
}
interface CheckRow {
  check: { id: string; label: string; source: string; track?: '1A' | '1B' | '1C' };
  result: CheckResult;
}

// L2 Validation Gate sub-track headers (walkthrough §2). Only the validation
// stage tags its checks; everywhere else `track` is undefined → flat render.
const TRACK_LABEL: Record<'1A' | '1B' | '1C', string> = {
  '1A': '1A · Market',
  '1B': '1B · Technical',
  '1C': '1C · Problem-Solution Fit',
};
const TRACK_ORDER: Array<'1A' | '1B' | '1C'> = ['1A', '1B', '1C'];
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

  return (
    <div data-tour="stage-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
          {/* Untracked checks first (every non-validation stage), then the
              Validation Gate's 1A/1B/1C tracks under small sub-headers. */}
          {headline.results.filter((r) => !r.check.track).map(({ check, result }) => (
            <CheckRowView key={check.id} projectId={projectId} check={check} result={result} />
          ))}
          {TRACK_ORDER.map((tk) => {
            const rows = headline.results.filter((r) => r.check.track === tk);
            if (rows.length === 0) return null;
            const done = rows.filter((r) => r.result.passed).length;
            return (
              <div key={tk}>
                <div style={{ padding: '8px 14px 2px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="lp-mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, color: 'var(--ink-5)', textTransform: 'uppercase' }}>
                    {TRACK_LABEL[tk]}
                  </span>
                  <span className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-6, var(--ink-5))' }}>{done}/{rows.length}</span>
                </div>
                {rows.map(({ check, result }) => (
                  <CheckRowView key={check.id} projectId={projectId} check={check} result={result} />
                ))}
              </div>
            );
          })}
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
              Next: address the gaps above with the Co-pilot.
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

function CheckRowView({ projectId, check, result }: { projectId: string; check: CheckRow['check']; result: CheckResult }) {
  const t = useT();
  // Unmet checks get an actionable CTA that pre-fills the Co-pilot composer with
  // the prompt for THIS substep (cross-page via ?prefill — the chat page loads
  // it on mount). Passed checks keep their source tag (the proof's home key).
  const prefillHref = `/project/${projectId}/chat?prefill=${encodeURIComponent(checkActionPrompt(check.label, t))}`;
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
      {result.passed ? (
        <span className="lp-mono" style={{
          fontSize: 9.5,
          color: 'var(--ink-5)',
          letterSpacing: 0.3,
          flexShrink: 0,
        }}>
          {check.source}
        </span>
      ) : (
        <Link href={prefillHref} title={`${check.source} · ask the Co-pilot to validate this`} style={askCtaStyle}>
          Ask Co-pilot →
        </Link>
      )}
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

// Per-check CTA — accent-washed pill so an unmet row reads as "actionable,
// pending" (the accent hue = the active/pending state used across the journey).
// Charcoal label (NOT accent-ink) on the pale-peach wash: dark-peach-on-peach
// read as "red on red" (founder feedback); the peach border carries the cue.
const askCtaStyle: React.CSSProperties = {
  flexShrink: 0,
  whiteSpace: 'nowrap',
  fontSize: 10.5,
  fontWeight: 600,
  color: 'var(--ink)',
  background: 'var(--accent-wash)',
  border: '1px solid var(--accent)',
  borderRadius: 999,
  padding: '3px 9px',
  textDecoration: 'none',
};
