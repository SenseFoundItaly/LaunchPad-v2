'use client';

import type { ScoreBadge as ScoreBadgeType } from '@/types/artifacts';

interface ScoreBadgeProps {
  artifact: ScoreBadgeType;
}

function getScoreColor(score: number, max: number): string {
  const pct = max > 0 ? score / max : 0;
  if (pct >= 0.75) {return '#22c55e';} // green-500
  if (pct >= 0.5) {return '#eab308';} // yellow-500
  return '#ef4444'; // red-500
}

export default function ScoreBadge({ artifact }: ScoreBadgeProps) {
  const color = getScoreColor(artifact.score, artifact.max);
  const pct = artifact.max > 0 ? artifact.score / artifact.max : 0;
  // SVG circle parameters for a 40x40 badge
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);

  return (
    <span className="inline-flex items-center gap-2 my-1 align-middle">
      <svg width="40" height="40" viewBox="0 0 40 40" className="flex-shrink-0">
        {/* Background track */}
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-paper-3"
          strokeWidth="3"
        />
        {/* Score arc */}
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 20 20)"
          className="transition-all duration-500"
        />
        {/* Score text */}
        <text
          x="20"
          y="21"
          textAnchor="middle"
          dominantBaseline="middle"
          className="text-[10px] font-semibold fill-ink-2"
        >
          {artifact.score}
        </text>
      </svg>
      <span className="text-xs text-ink-4">
        {artifact.label} ({artifact.score}/{artifact.max})
      </span>
    </span>
  );
}
