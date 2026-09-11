'use client';

import type { ScoreDimension } from '@/types';

interface ScoreCardProps {
  dimension: ScoreDimension;
}

export default function ScoreCard({ dimension }: ScoreCardProps) {
  const getColor = (score: number) => {
    if (score >= 75) {return 'text-moss';}
    if (score >= 50) {return 'text-accent';}
    return 'text-clay';
  };

  return (
    <div className="bg-paper border border-line rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-ink-2">{dimension.name}</h3>
        <span className={`text-lg font-bold ${getColor(dimension.score)}`}>{dimension.score}</span>
      </div>
      <div className="w-full h-1.5 bg-paper-2 rounded-full mb-3">
        <div
          className="h-full bg-moss rounded-full transition-all"
          style={{ width: `${dimension.score}%` }}
        />
      </div>
      <p className="text-xs text-ink-4 mb-2">{dimension.rationale}</p>
      {dimension.strengths.length > 0 && (
        <div className="mb-2">
          <span className="text-xs text-moss">Strengths: </span>
          <span className="text-xs text-ink-4">{dimension.strengths.join(', ')}</span>
        </div>
      )}
      {dimension.risks.length > 0 && (
        <div>
          <span className="text-xs text-clay">Risks: </span>
          <span className="text-xs text-ink-4">{dimension.risks.join(', ')}</span>
        </div>
      )}
    </div>
  );
}
