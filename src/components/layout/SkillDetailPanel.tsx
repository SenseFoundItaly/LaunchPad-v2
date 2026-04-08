'use client';

import Link from 'next/link';
import type { SkillData, SkillStatus } from '@/hooks/useSkillStatus';
import type { SkillDef } from '@/lib/stages';
import { SKILL_NEXT_STEPS, STAGES } from '@/lib/stages';
import SkillOutputRenderer from '@/components/skill/SkillOutputRenderer';
import SourceBadges from '@/components/skill/SourceBadges';

interface SkillDetailPanelProps {
  skill: SkillDef;
  data: SkillData;
  projectId: string;
  skillStatus: Record<string, SkillStatus>;
  onClose: () => void;
}

export default function SkillDetailPanel({ skill, data, projectId, skillStatus, onClose }: SkillDetailPanelProps) {
  const nextSteps = SKILL_NEXT_STEPS[skill.id] || [];

  // Resolve skill label from id
  function getSkillLabel(skillId: string): string {
    for (const stage of STAGES) {
      for (const s of stage.skills) {
        if (s.id === skillId) return s.label;
      }
    }
    return skillId;
  }

  function getSkillRoute(skillId: string): string {
    for (const stage of STAGES) {
      for (const s of stage.skills) {
        if (s.id === skillId) return s.route;
      }
    }
    return `chat?skill=${skillId}`;
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />

      <div className="w-[520px] bg-zinc-950 border-l border-zinc-800 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-white">{skill.label}</h3>
            <div className="flex items-center gap-2 mt-1">
              {data.status === 'completed' ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Completed</span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400">Not run</span>
              )}
              {data.completedAt && (
                <span className="text-[10px] text-zinc-600">
                  {new Date(data.completedAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg">&times;</button>
        </div>

        {/* Source badges */}
        {data.status === 'completed' && (
          <div className="px-5 py-2 border-b border-zinc-800/50">
            <SourceBadges skillId={skill.id} skillStatus={skillStatus} />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {data.status === 'completed' && data.summary ? (
            <div className="p-5">
              <SkillOutputRenderer content={data.summary} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="text-zinc-600 text-3xl mb-3">-</div>
              <p className="text-sm text-zinc-400 mb-1">This skill hasn't been run yet</p>
              <p className="text-xs text-zinc-600 mb-4">Click below to start this validation step</p>
              <Link
                href={`/project/${projectId}/${skill.route}`}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
                onClick={onClose}
              >
                Run {skill.label}
              </Link>
            </div>
          )}
        </div>

        {/* Footer — contextual next steps */}
        {data.status === 'completed' && (
          <div className="px-5 py-4 border-t border-zinc-800 shrink-0 space-y-2">
            {nextSteps.length > 0 && (
              <>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Next steps</div>
                <div className="space-y-1.5">
                  {nextSteps.map((step) => (
                    <Link
                      key={step.skillId}
                      href={`/project/${projectId}/${getSkillRoute(step.skillId)}&t=${Date.now()}`}
                      onClick={onClose}
                      className="flex items-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-lg transition-colors group"
                    >
                      <span className="text-xs text-blue-400 group-hover:text-blue-300">&rarr;</span>
                      <span className="text-sm text-zinc-300 group-hover:text-zinc-100 flex-1">{step.label}</span>
                      <span className="text-[10px] text-zinc-600">{getSkillLabel(step.skillId)}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
            <Link
              href={`/project/${projectId}/${skill.route}&t=${Date.now()}`}
              className="block text-center px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              onClick={onClose}
            >
              Re-run in Chat
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
