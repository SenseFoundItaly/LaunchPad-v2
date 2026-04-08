'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/api';
import { STAGES } from '@/lib/stages';

export type SkillStatus = 'completed' | 'stale' | 'not_run';

export interface SkillData {
  status: SkillStatus;
  summary?: string;
  completedAt?: string;
}

export interface StageCompletion {
  completed: number;
  total: number;
}

export function useSkillStatus(projectId: string) {
  const [skills, setSkills] = useState<Record<string, SkillData>>({});
  const [overallReadiness, setOverallReadiness] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get(`/api/projects/${projectId}/skills`);
      const completions: { skill_id: string; status: string; summary: string; completed_at: string }[] = data?.data || [];

      const skillMap: Record<string, SkillData> = {};
      for (const stage of STAGES) {
        for (const skill of stage.skills) {
          const found = completions.find((c) => c.skill_id === skill.id);
          skillMap[skill.id] = found
            ? { status: 'completed', summary: found.summary, completedAt: found.completed_at }
            : { status: 'not_run' };
        }
      }

      setSkills(skillMap);

      const allSkills = STAGES.flatMap((s) => s.skills);
      const completedCount = allSkills.filter((s) => skillMap[s.id]?.status === 'completed').length;
      setOverallReadiness(allSkills.length > 0 ? Math.round((completedCount / allSkills.length) * 100) : 0);
    } catch {
      const skillMap: Record<string, SkillData> = {};
      for (const stage of STAGES) {
        for (const skill of stage.skills) {
          skillMap[skill.id] = { status: 'not_run' };
        }
      }
      setSkills(skillMap);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Derived: simple status map for backward compat
  const skillStatus: Record<string, SkillStatus> = {};
  for (const [id, data] of Object.entries(skills)) {
    skillStatus[id] = data.status;
  }

  const stageCompletion: Record<number, StageCompletion> = {};
  for (const stage of STAGES) {
    const completed = stage.skills.filter((s) => skills[s.id]?.status === 'completed').length;
    stageCompletion[stage.number] = { completed, total: stage.skills.length };
  }

  return { skills, skillStatus, stageCompletion, overallReadiness, loading, refresh };
}
