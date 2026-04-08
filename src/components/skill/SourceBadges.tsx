'use client';

import { SKILL_SOURCES, STAGES } from '@/lib/stages';
import type { SkillStatus } from '@/hooks/useSkillStatus';

interface SourceBadgesProps {
  skillId: string;
  skillStatus: Record<string, SkillStatus>;
}

function getSkillLabel(id: string): string {
  for (const stage of STAGES) {
    for (const s of stage.skills) {
      if (s.id === id) return s.label;
    }
  }
  return id;
}

export default function SourceBadges({ skillId, skillStatus }: SourceBadgesProps) {
  const sources = SKILL_SOURCES[skillId];
  if (!sources || sources.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-zinc-600">Sources:</span>
      {sources.map((srcId) => {
        const completed = skillStatus[srcId] === 'completed';
        return (
          <span
            key={srcId}
            className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              completed
                ? 'bg-green-500/20 text-green-400'
                : 'bg-zinc-700/50 text-zinc-500'
            }`}
          >
            {getSkillLabel(srcId)} {completed ? '+' : '-'}
          </span>
        );
      })}
    </div>
  );
}
