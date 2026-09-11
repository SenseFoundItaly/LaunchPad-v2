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
import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import { useStages } from '@/hooks/useStages';
import { stageLabel } from '@/lib/journey-prompts';
import type { MessageKey } from '@/lib/i18n/messages';

interface ScoreDimensionLite { name: string; score: number }
interface ScoreResp {
  overall_score: number | null;
  // Stored as a JSONB OBJECT MAP (name -> numeric score); older/corrupted rows
  // may be a JSON string or an array of {name,score}. Kept `unknown` and
  // normalized at read time — see normalizeDimensions.
  dimensions: unknown;
  recommendation: string | null;
  scored_at: string | null;
}

// scores.dimensions is persisted as a JSONB object map (e.g. {"Problem": 7.2}),
// NOT an array. The panel previously did Array.isArray(...) and silently rendered
// an EMPTY breakdown for every project. Normalize the object map (and the
// defensive array / double-encoded-string shapes) into [{name, score}].
function normalizeDimensions(raw: unknown): ScoreDimensionLite[] {
  let d = raw;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return []; }
  }
  if (Array.isArray(d)) {
    return d.filter(
      (x): x is ScoreDimensionLite =>
        !!x && typeof x === 'object' &&
        typeof (x as ScoreDimensionLite).name === 'string' &&
        typeof (x as ScoreDimensionLite).score === 'number',
    );
  }
  if (d && typeof d === 'object') {
    return Object.entries(d as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
      .map(([name, v]) => ({ name, score: v as number }));
  }
  return [];
}

// Qualitative band — aligned with the anti-sycophancy scoring guardrails
// (70+ = strong/verified, 40-or-below = serious warning). Colors mirror the spine.
function band(score: number): { key: MessageKey; color: string } {
  if (score >= 70) return { key: 'score.band-strong', color: 'var(--moss)' };
  if (score >= 55) return { key: 'score.band-promising', color: 'var(--accent)' };
  if (score >= 40) return { key: 'score.band-caution', color: 'var(--clay)' };
  return { key: 'score.band-weak', color: 'var(--clay)' };
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
  const autoScoreFired = useRef(false);
  const scoreLoaded = score !== undefined;
  const stagesDone = evals.filter((e) => e.status === 'done').length;
  const needsScore = typeof score?.overall_score !== 'number';
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

  const overall = typeof score?.overall_score === 'number' ? Math.round(score.overall_score) : null;
  const dims = normalizeDimensions(score?.dimensions);
  const total = evals.length || 7;
  const done = evals.filter((e) => e.status === 'done').length;
  const active = evals.find((e) => e.status === 'active');
  const runHref = `/project/${projectId}/chat?prefill=${encodeURIComponent(t('journey-prompt.scoring'))}`;

  return (
    <section data-tour="score-panel" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-l)', overflow: 'hidden' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon d={I.bolt} size={13} stroke={1.4} style={{ color: 'var(--ink-3)' }} />
        <h2 style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ink-3)' }}>
          {t('score.title')}
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
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="lp-serif" style={{ fontSize: 30, lineHeight: 1, color: 'var(--ink)' }}>{overall}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-5)' }}>/ 100</span>
                <span className="lp-mono" style={{ fontSize: 10, color: band(overall).color, letterSpacing: 0.3 }}>{t(band(overall).key)}</span>
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
              {score?.recommendation && (
                <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.45 }}>{score.recommendation}</p>
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
            <span className="lp-serif" style={{ fontSize: 30, lineHeight: 1, color: 'var(--ink)' }}>{done}</span>
            <span style={{ fontSize: 13, color: 'var(--ink-5)' }}>/ {total}</span>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', letterSpacing: 0.3 }}>{t('score.irl-stages')}</span>
          </div>
          {active && (
            <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.45 }}>
              {t('score.irl-current', { stage: stageLabel(active.stage.id, active.stage.label, t) })}
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
