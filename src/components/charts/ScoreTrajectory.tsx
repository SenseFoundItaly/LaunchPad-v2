'use client';

/**
 * ScoreTrajectory — a compact sparkline + delta over the startup-score history.
 *
 * The /score-history endpoint (and the score_history table it reads) already
 * exist for exactly this — "score up N since baseline" — but nothing in the UI
 * consumed them. Surfaced on the rich baseline score card so the founder sees
 * the score MOVE as they validate, not just its current value.
 *
 * Each point is normalized via to100 so a history that mixes legacy 0-10 rows
 * with 0-100 canon rows plots on one scale. Renders nothing with < 2 points
 * (no trajectory to show yet).
 */

import { useQuery } from '@tanstack/react-query';
import { to100 } from '@/lib/score-display';
import { useT } from '@/components/providers/LocaleProvider';

interface HistoryResp {
  points: Array<{ overall_score: number; created_at: string }>;
}

export default function ScoreTrajectory({ projectId }: { projectId: string }) {
  const t = useT();
  const { data } = useQuery<HistoryResp | null>({
    queryKey: ['score-history', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/score-history`);
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      return (body?.data ?? body) as HistoryResp | null;
    },
  });

  const pts = (data?.points ?? [])
    .map((p) => (typeof p.overall_score === 'number' ? to100(p.overall_score) : null))
    .filter((v): v is number => v != null);

  if (pts.length < 2) return null;

  const delta = Math.round(pts[pts.length - 1] - pts[0]);
  const up = delta >= 0;
  const color = up ? 'var(--moss)' : 'var(--clay)';

  // Sparkline geometry — small, fixed box; y inverted (SVG origin top-left).
  const W = 56, H = 16, pad = 1.5;
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const span = hi - lo || 1;
  const coords = pts.map((v, i) => {
    const x = pad + (i / (pts.length - 1)) * (W - 2 * pad);
    const y = pad + (1 - (v - lo) / span) * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <span className="inline-flex items-center gap-1.5" title={t('score.trajectory-tooltip', { count: pts.length, delta: `${up ? '+' : ''}${delta}` })}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden style={{ overflow: 'visible' }}>
        <polyline
          points={coords.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={1.4}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={coords[coords.length - 1].split(',')[0]} cy={coords[coords.length - 1].split(',')[1]} r={1.8} fill={color} />
      </svg>
      <span className="lp-mono text-[10px]" style={{ color }}>{up ? '+' : ''}{delta}</span>
    </span>
  );
}
