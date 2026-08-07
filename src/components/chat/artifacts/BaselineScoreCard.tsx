'use client';

/**
 * BaselineScoreCard — the rich in-chat rendering of THE project baseline score
 * (a score-card artifact whose title is baseline-flagged, see
 * isBaselineScoreTitle). The generic score-card renderer showed only a number +
 * one-line description; the founder asked for "più dettaglio" at the idea →
 * Validation Gate hand-off (changelog 5.1).
 *
 * It reads the AUTHORITATIVE persisted score (GET /score, the same ['score']
 * cache Home's ScorePanel uses) so the canvas card and Home always show the
 * SAME number + dimension breakdown — the copilot-6.8-vs-Home-/100 mismatch the
 * founder hit. Renders the inner body only; ArtifactRenderer wraps it in the
 * shared card shell (title / sources / export). Falls back to the thin
 * ScoreCard while loading or when no baseline is persisted yet.
 */

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useT } from '@/components/providers/LocaleProvider';
import { ScoreCard } from '@/components/charts';
import { Pill } from '@/components/design/primitives';
import ScoreTrajectory from '@/components/charts/ScoreTrajectory';
import { band, normalizeDimensions, to100, splitVerdict } from '@/lib/score-display';
import type { ScoreCardArtifact } from '@/types/artifacts';

interface ScoreResp {
  overall_score: number | null;
  dimensions: unknown;
  recommendation: string | null;
  scored_at: string | null;
  /** Which scoring produced the headline — GET /score derives it from the
   *  trajectory's newest source (clarity pre-gate, startup post-1A/1B). */
  kind?: 'clarity' | 'startup';
}

export default function BaselineScoreCard({ artifact }: { artifact: ScoreCardArtifact }) {
  const t = useT();
  const params = useParams();
  const projectId = typeof params?.projectId === 'string'
    ? params.projectId
    : Array.isArray(params?.projectId) ? params.projectId[0] ?? '' : '';

  const { data, isLoading } = useQuery<ScoreResp | null>({
    queryKey: ['score', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/score`);
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      return (body?.data ?? body) as ScoreResp | null;
    },
  });

  // No authoritative baseline yet (or still loading, or fetch failed): fall back
  // to the artifact's own score so the card never renders empty.
  const overallRaw = typeof data?.overall_score === 'number' ? data.overall_score : null;
  if (isLoading || overallRaw == null || overallRaw <= 0) {
    return <ScoreCard title="" score={artifact.score} maxScore={artifact.maxScore} description={artifact.description} />;
  }

  const overall = Math.round(to100(overallRaw));
  const b = band(overall);
  const dims = normalizeDimensions(data?.dimensions).map((d) => ({ ...d, score: to100(d.score) }));
  // Same splitter as Home's ScorePanel — a Clarity verdict renders as a chip,
  // not as the first word of the prose.
  const { verdict, text: recText } = splitVerdict(data?.recommendation?.trim() || null);
  const recommendation = recText || artifact.description?.trim() || '';
  const kindLabel = data?.kind === 'clarity' ? t('score.title-clarity') : data?.kind === 'startup' ? t('score.title-startup') : null;

  // The verdict is the card's protagonist (changelog 4/08 "più dettaglio sia
  // nel contenuto che nell'interfaccia"): chip + narrative live together in one
  // tinted, verdict-colored block — a GO reads green at a glance, a NO GO reads
  // clay, and the summary explains it in the same breath instead of trailing as
  // disconnected grey prose under the bars.
  const verdictColor = verdict === 'GO' ? 'var(--moss)' : verdict === 'NO GO' ? 'var(--clay)' : 'var(--accent)';

  return (
    <div className="my-1">
      {/* Which score this IS (changelog 4/08: the founder read a Clarity-band
          number as a verdict on his idea). Naming the scale is the detail that
          disarms that misreading. */}
      {kindLabel && (
        <div className="lp-mono text-[9.5px] uppercase tracking-wide text-ink-5 mb-1.5">{kindLabel}</div>
      )}
      {/* Headline: score / 100 + qualitative band + trajectory sparkline.
          flex-wrap so a narrow canvas card wraps the sparkline to a second
          line instead of overflowing the card's right edge. */}
      <div className="flex items-baseline gap-x-2 gap-y-1 flex-wrap">
        <span className="lp-serif leading-none text-ink" style={{ fontSize: 34 }}>{overall}</span>
        <span className="text-sm text-ink-5">/ 100</span>
        <span className="lp-mono text-xs tracking-wide" style={{ color: b.color }}>{t(b.key)}</span>
        <span className="ml-auto self-center"><ScoreTrajectory projectId={projectId} /></span>
      </div>

      {/* Verdict story block — chip + summary as ONE unit. Absent verdict
          (legacy startup scores, prose-parsed runs) degrades to plain prose. */}
      {verdict ? (
        <div
          className="mt-3"
          style={{
            padding: '10px 12px',
            borderLeft: `3px solid ${verdictColor}`,
            borderRadius: 'var(--r-m)',
            background: `color-mix(in srgb, ${verdictColor} 7%, transparent)`,
          }}
        >
          <Pill kind={verdict === 'GO' ? 'ok' : verdict === 'NO GO' ? 'warn' : 'info'} dot>{verdict}</Pill>
          {recommendation && (
            <p className="mt-2 mb-0 text-[11.5px] leading-relaxed text-ink-3">{recommendation}</p>
          )}
        </div>
      ) : recommendation ? (
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-4">{recommendation}</p>
      ) : null}

      {/* Per-dimension breakdown — same bars as Home's ScorePanel, AFTER the
          verdict: the founder reads the judgement first, the anatomy second. */}
      {dims.length > 0 && (
        <div className="mt-3 flex flex-col gap-[7px]">
          {dims.map((d) => (
            <div key={d.name} className="flex items-center gap-2">
              <span className="flex-1 min-w-0 text-[11px] text-ink-3 truncate">{d.name}</span>
              <span className="w-16 h-[6px] rounded-full overflow-hidden shrink-0" style={{ background: 'var(--paper-3)' }}>
                <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, d.score))}%`, background: band(d.score).color }} />
              </span>
              <span className="lp-mono w-6 text-right text-[10px] text-ink-4 shrink-0">{Math.round(d.score)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
