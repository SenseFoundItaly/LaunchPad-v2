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

      <div className="w-[520px] bg-surface-sunk border-l border-line flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-line flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-ink">{skill.label}</h3>
            <div className="flex items-center gap-2 mt-1">
              {data.status === 'completed' ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-moss-wash text-moss">Completed</span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-paper-3 text-ink-4">Not run</span>
              )}
              {data.completedAt && (
                <span className="text-[10px] text-ink-6">
                  {new Date(data.completedAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-ink-5 hover:text-ink-3 text-lg">&times;</button>
        </div>

        {/* Source badges */}
        {data.status === 'completed' && (
          <div className="px-5 py-2 border-b border-line/50">
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
              <div className="text-ink-6 text-3xl mb-3">-</div>
              <p className="text-sm text-ink-4 mb-1">This skill hasn't been run yet</p>
              <p className="text-xs text-ink-6 mb-4">Click below to start this validation step</p>
              <Link
                href={`/project/${projectId}/${skill.route}`}
                className="px-4 py-2 bg-moss hover:bg-moss/80 text-white text-sm rounded-lg transition-colors"
                onClick={onClose}
              >
                Run {skill.label}
              </Link>
            </div>
          )}
        </div>

        {/* Footer — contextual next steps */}
        {data.status === 'completed' && (
          <div className="px-5 py-4 border-t border-line shrink-0 space-y-2">
            {nextSteps.length > 0 && (
              <>
                <div className="text-[10px] text-ink-5 uppercase tracking-wider mb-2">Next steps</div>
                <div className="space-y-1.5">
                  {nextSteps.map((step) => (
                    <Link
                      key={step.skillId}
                      href={`/project/${projectId}/${getSkillRoute(step.skillId)}&t=${Date.now()}`}
                      onClick={onClose}
                      className="flex items-center gap-2 px-3 py-2 bg-paper hover:bg-paper-2 border border-line hover:border-line-2 rounded-lg transition-colors group"
                    >
                      <span className="text-xs text-moss group-hover:text-moss/80">&rarr;</span>
                      <span className="text-sm text-ink-3 group-hover:text-ink flex-1">{step.label}</span>
                      <span className="text-[10px] text-ink-6">{getSkillLabel(step.skillId)}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
            <Link
              href={`/project/${projectId}/${skill.route}&t=${Date.now()}`}
              className="block text-center px-3 py-1.5 text-xs text-ink-5 hover:text-ink-3 transition-colors"
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
