'use client';

/**
 * ScorePanel (changelog 17/06 bottom item 2): the startup score on Home, with the
 * two distinct readouts the founder asked to keep separate:
 *   - PROJECT SCORE — 0–100 idea-potential from the startup-scoring skill, with a
 *     per-dimension breakdown + a qualitative band + a "run anytime" action. Moves
 *     with the founder's actions (improves/worsens as the idea is validated).
 *   - IRL (Investment Readiness Level) — venture-building progress, derived from
 *     how many of the 7 journey stages are validated. Tracks the march toward
 *     investor-readiness, NOT idea quality.
 *
 * Reuses the cached ['stages'] query (NextToValidate already fetches it) for IRL,
 * and a small dedicated /score endpoint for the project score.
 */

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MessageKey } from '@/lib/i18n/messages';
// ladder.ts is pure (zero DB/journey imports, by design) so it is client-safe.
// Deriving the rung label from it means the UI cannot drift from the engine —
// a hand-copied key→label map would.
import { IRL_LADDER } from '@/lib/irl/ladder';
import { quadrantFor, quadrantMessageKey } from '@/lib/irl/quadrant';
import { Icon, I, Pill } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import { useStages } from '@/hooks/useStages';
import { stageLabel } from '@/lib/journey-prompts';
import { band, normalizeDimensions, to100 } from '@/lib/score-display';
import ScoreTrajectory from '@/components/charts/ScoreTrajectory';

interface IrlResp {
  /** What the founder sees — max(earned, stored floor). */
  level: number;
  of: number;
  next_key: string | null;
  /** Highest level any project can currently reach — levels above this have no
   *  evidence feed yet (#338), so "/ 9" alone would promise a climb that
   *  cannot happen. */
  reachable_max: number;
  /** What today's evidence supports on its own. */
  earned: number;
  /** level > earned: a signal has slipped below a rung already earned. */
  regressed: boolean;
  current_stage_id: string | null;
  current_stage_label: string | null;
}

interface ScoreResp {
  overall_score: number | null;
  // Stored as a JSONB OBJECT MAP (name -> numeric score); older/corrupted rows
  // may be a JSON string or an array of {name,score}. Kept `unknown` and
  // normalized at read time — see normalizeDimensions.
  dimensions: unknown;
  recommendation: string | null;
  kind?: 'clarity' | 'startup';
  scored_at: string | null;
}

// band / normalizeDimensions / to100 now live in @/lib/score-display so the
// in-chat baseline card renders identically (imported below).

interface ScoreHistoryResp {
  points: Array<{ overall_score: number; created_at: string }>;
  count: number;
  delta: number | null;
}

export function ScorePanel({ projectId }: { projectId: string }) {
  const t = useT();

  const { data: score } = useQuery<ScoreResp>({
    queryKey: ['score', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/score`);
      const body = await res.json();
      return (body?.data ?? body) as ScoreResp;
    },
  });

  // IRL — the 1-9 evidence-gated ladder (src/lib/irl/ladder.ts). Computed
  // server-side from the snapshot; distinct from the naive done/total stage
  // count (which still drives the auto-score trigger below).
  const { data: irl } = useQuery<IrlResp>({
    queryKey: ['irl', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/irl`);
      const body = await res.json();
      return (body?.data ?? body) as IrlResp;
    },
  });

  // IRL is derived from how many journey stages are validated. Consume the
  // canonical useStages hook (shared ['stages', projectId] cache, ONE shape —
  // the sorted evaluations array) rather than a bespoke object-shaped query,
  // which used to poison the cache by mount order. See useStages.ts.
  const { data: stageEvals, isLoading: stagesLoading } = useStages(projectId);
  const evals = stageEvals ?? [];

  // Auto-score on stage advance (Option A): when the founder lands on Home past
  // Stage 2 with no score yet, fire the gated POST /score (auto) so the score
  // appears automatically — no manual click. The server enforces the real gate +
  // debounce, so this client trigger is best-effort and safe (it no-ops server-side).
  const queryClient = useQueryClient();
  const nextRungLabelKey = IRL_LADDER.find((r) => r.key === irl?.next_key)?.labelKey ?? null;

  // Score × IRL — the accelerator/VC reading. Uses the FLOORED level (what the
  // founder is credited with), not `earned`: the quadrant is a standing
  // characterisation of the project, and it should not flicker because one
  // signal dipped this week. `regressed` already communicates the dip.
  const quadrant = quadrantFor(score?.overall_score ?? null, irl?.level ?? 0);

  // The IRL badge is set once and was never invalidated, so it stayed stale
  // until a remount — a founder could earn a rung and watch the number not
  // move. Reconcile on the same bridge every other topic uses.
  useEffect(() => {
    if (!projectId || typeof window === 'undefined') return;
    const handler = () => queryClient.invalidateQueries({ queryKey: ['irl', projectId] });
    window.addEventListener('lp-actions-changed', handler);
    window.addEventListener('lp-skills-changed', handler);
    return () => {
      window.removeEventListener('lp-actions-changed', handler);
      window.removeEventListener('lp-skills-changed', handler);
    };
  }, [projectId, queryClient]);
  const autoScoreFired = useRef(false);
  const scoreLoaded = score !== undefined;
  const stagesDone = evals.filter((e) => e.status === 'done').length;
  // 0 counts as unscored: legacy score-card/radar INSERTs fabricated a literal
  // 0 baseline (now NULL at the write side) — those rows must both render as
  // "not scored" and stay eligible for the auto-score heal below.
  const needsScore = !(typeof score?.overall_score === 'number' && score.overall_score > 0);
  useEffect(() => {
    if (autoScoreFired.current) return;
    if (!scoreLoaded || stagesLoading) return;  // wait for both queries
    if (!needsScore || stagesDone < 2) return;  // only when unscored + past Stage 2
    autoScoreFired.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto: true }),
        });
        const reader = res.body?.getReader();       // drain the SSE stream to completion
        if (reader) { for (;;) { const { done } = await reader.read(); if (done) break; } }
        queryClient.invalidateQueries({ queryKey: ['score', projectId] });
      } catch { /* best-effort */ }
    })();
  }, [scoreLoaded, stagesLoading, needsScore, stagesDone, projectId, queryClient]);

  const overall =
    typeof score?.overall_score === 'number' && score.overall_score > 0
      ? Math.round(to100(score.overall_score))
      : null;
  const dims = normalizeDimensions(score?.dimensions).map((d) => ({ ...d, score: to100(d.score) }));
  // IRL now comes from the /irl ladder endpoint (the `irl` query above); the
  // done/total stage count is no longer the readout. `active` still drives the
  // "currently in {stage}" line.
  const active = evals.find((e) => e.status === 'active');
  // Clarity verdict rides as a prefix of the recommendation string ("GO — ...",
  // parser contract in score-summary.ts). Peel it off for a chip; the remainder
  // renders as the usual prose. A recommendation without the prefix (older
  // scores, prose-parsed runs) falls through untouched.
  const verdictMatch = score?.recommendation?.match(/^(GO|PIVOT PARZIALE|NO GO)(?: — ?| - ?)?/);
  const verdict = verdictMatch?.[1] ?? null;
  const recommendationText = verdictMatch
    ? (score?.recommendation ?? '').slice(verdictMatch[0].length).trim() || null
    : (score?.recommendation ?? null);
  const runHref = `/project/${projectId}/chat?prefill=${encodeURIComponent(t('journey-prompt.scoring'))}`;

  return (
    <section data-tour="score-panel" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-l)', overflow: 'hidden' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon d={I.bolt} size={13} stroke={1.4} style={{ color: 'var(--ink-3)' }} />
        <h2 style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ink-3)' }}>
          {score?.kind === 'clarity' ? t('score.title-clarity') : score?.kind === 'startup' && (score?.overall_score ?? 0) > 0 ? t('score.title-startup') : t('score.title')}
        </h2>
        <Link
          href={runHref}
          style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)', textDecoration: 'none', fontFamily: 'var(--f-mono)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          {t('score.run')} <Icon d={I.arrow} size={10} stroke={1.4} />
        </Link>
      </header>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* PROJECT SCORE */}
        <div style={{ minWidth: 0 }}>
          <div className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            {t('score.project-score')}
          </div>
          {overall === null ? (
            <div style={{ fontSize: 12.5, color: 'var(--ink-4)', fontStyle: 'italic' }}>
              {t('score.not-scored')} <Link href={runHref} style={{ color: 'var(--accent-ink, var(--accent))' }}>{t('score.run')} →</Link>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', rowGap: 4 }}>
                <span className="lp-serif" style={{ fontSize: 30, lineHeight: 1, color: 'var(--ink)' }}>{overall}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-5)' }}>/ 100</span>
                <span className="lp-mono" style={{ fontSize: 10, color: band(overall).color, letterSpacing: 0.3 }}>{t(band(overall).key)}</span>
                <span style={{ marginLeft: 'auto', alignSelf: 'center' }}><ScoreTrajectory projectId={projectId} /></span>
              </div>
              {dims.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {dims.map((d) => (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
                      <span style={{ width: 56, height: 5, borderRadius: 3, background: 'var(--paper-3)', overflow: 'hidden', flexShrink: 0 }}>
                        <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, d.score))}%`, background: band(d.score).color }} />
                      </span>
                      <span className="lp-mono" style={{ width: 20, textAlign: 'right', fontSize: 10, color: 'var(--ink-4)', flexShrink: 0 }}>{Math.round(d.score)}</span>
                    </div>
                  ))}
                </div>
              )}
              {verdict && (
                <div style={{ marginTop: 10 }}>
                  <Pill kind={verdict === 'GO' ? 'ok' : verdict === 'NO GO' ? 'warn' : 'info'} dot>{verdict}</Pill>
                </div>
              )}
              {recommendationText && (
                <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.45 }}>{recommendationText}</p>
              )}
            </>
          )}
        </div>

        {/* IRL */}
        <div style={{ minWidth: 0, borderLeft: '1px solid var(--line)', paddingLeft: 16 }}>
          <div className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            {t('score.irl-title')}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="lp-serif" style={{ fontSize: 30, lineHeight: 1, color: 'var(--ink)' }}>{irl ? irl.level : '—'}</span>
            <span style={{ fontSize: 13, color: 'var(--ink-5)' }}>/ {irl?.of ?? 9}</span>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', letterSpacing: 0.3 }}>{t('score.irl-level')}</span>
          </div>
          {active && (
            <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.45 }}>
              {t('score.irl-current', { stage: stageLabel(active.stage.id, active.stage.label, t) })}
            </p>
          )}
          {irl?.regressed && (
            /* The number is being HELD UP by the floor. Saying so is the whole
               point of the floor: IRL stays a milestone, but the founder still
               learns a signal slipped — silence would be a prettier lie. */
            <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--clay)', lineHeight: 1.45 }}>
              {t('score.irl-regressed', { earned: irl.earned })}
            </p>
          )}
          {/* What earns the NEXT point. The API has always returned next_key and
              the UI threw it away — so a founder saw "2/9" with no idea what
              gets them to 3, against "ogni punto si suda". */}
          {nextRungLabelKey && (
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>
              {t('score.irl-next', { rung: t(`irl.level-${nextRungLabelKey}` as MessageKey) })}
            </p>
          )}
          {/* Don't promise a climb the product can't deliver: levels above
              reachable_max have no evidence feed yet (#338). Mirrors how
              PhaseSpine marks Loops 3-4 "coming soon". */}
          {irl && irl.reachable_max < irl.of && (
            <p style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--ink-5)', lineHeight: 1.4 }}>
              {t('score.irl-capped', { from: irl.reachable_max + 1 })}
            </p>
          )}
          {/* The two-axis reading. Only rendered once a score exists — an
              unscored project is unmeasured, not "low potential". */}
          {quadrant && (
            <p style={{ margin: '10px 0 0', paddingTop: 8, borderTop: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>
              {t(quadrantMessageKey(quadrant))}
            </p>
          )}
          <p style={{ margin: '8px 0 0', fontSize: 10.5, color: 'var(--ink-5)', lineHeight: 1.4, fontStyle: 'italic' }}>
            {t('score.irl-explainer')}
          </p>
        </div>
      </div>
    </section>
  );
}

export default ScorePanel;
