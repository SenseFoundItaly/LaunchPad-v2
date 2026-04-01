'use client';

import type { ScoreDimension } from '@/types';

interface ScoreCardProps {
  dimension: ScoreDimension;
}

export default function ScoreCard({ dimension }: ScoreCardProps) {
  const getColor = (score: number) => {
    if (score >= 75) {return 'text-green-400';}
    if (score >= 50) {return 'text-yellow-400';}
    return 'text-red-400';
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-zinc-200">{dimension.name}</h3>
        <span className={`text-lg font-bold ${getColor(dimension.score)}`}>{dimension.score}</span>
      </div>
      <div className="w-full h-1.5 bg-zinc-800 rounded-full mb-3">
        <div
          className="h-full bg-blue-500 rounded-full transition-all"
          style={{ width: `${dimension.score}%` }}
        />
      </div>
      <p className="text-xs text-zinc-400 mb-2">{dimension.rationale}</p>
      {dimension.strengths.length > 0 && (
        <div className="mb-2">
          <span className="text-xs text-green-400">Strengths: </span>
          <span className="text-xs text-zinc-400">{dimension.strengths.join(', ')}</span>
        </div>
      )}
      {dimension.risks.length > 0 && (
        <div>
          <span className="text-xs text-red-400">Risks: </span>
          <span className="text-xs text-zinc-400">{dimension.risks.join(', ')}</span>
        </div>
      )}
    </div>
  );
}
