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
import ScoreTrajectory from '@/components/charts/ScoreTrajectory';
import { band, normalizeDimensions, to100 } from '@/lib/score-display';
import type { ScoreCardArtifact } from '@/types/artifacts';

interface ScoreResp {
  overall_score: number | null;
  dimensions: unknown;
  recommendation: string | null;
  scored_at: string | null;
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
  const recommendation = data?.recommendation?.trim() || artifact.description?.trim() || '';

  return (
    <div className="my-1">
      {/* Headline: score / 100 + qualitative band + trajectory sparkline.
          flex-wrap so a narrow canvas card wraps the sparkline to a second
          line instead of overflowing the card's right edge. */}
      <div className="flex items-baseline gap-x-2 gap-y-1 flex-wrap">
        <span className="lp-serif text-3xl leading-none text-ink">{overall}</span>
        <span className="text-sm text-ink-5">/ 100</span>
        <span className="lp-mono text-xs tracking-wide" style={{ color: b.color }}>{t(b.key)}</span>
        <span className="ml-auto self-center"><ScoreTrajectory projectId={projectId} /></span>
      </div>

      {/* Per-dimension breakdown — same bars as Home's ScorePanel */}
      {dims.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {dims.map((d) => (
            <div key={d.name} className="flex items-center gap-2">
              <span className="flex-1 min-w-0 text-[11px] text-ink-3 truncate">{d.name}</span>
              <span className="w-14 h-[5px] rounded-full overflow-hidden shrink-0" style={{ background: 'var(--paper-3)' }}>
                <span className="block h-full" style={{ width: `${Math.max(0, Math.min(100, d.score))}%`, background: band(d.score).color }} />
              </span>
              <span className="lp-mono w-6 text-right text-[10px] text-ink-4 shrink-0">{Math.round(d.score)}</span>
            </div>
          ))}
        </div>
      )}

      {recommendation && (
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-4">{recommendation}</p>
      )}
    </div>
  );
}
