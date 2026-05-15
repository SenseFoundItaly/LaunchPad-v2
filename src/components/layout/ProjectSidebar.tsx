'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { STAGES, stageColors } from '@/lib/stages';
import type { SkillDef } from '@/lib/stages';
import { useSkillStatus } from '@/hooks/useSkillStatus';
import { scoreOverall } from '@/lib/scoring';
import SkillDetailPanel from './SkillDetailPanel';

interface ProjectSidebarProps {
  projectId: string;
  projectName?: string;
}

export default function ProjectSidebar({ projectId, projectName }: ProjectSidebarProps) {
  const pathname = usePathname();
  const { skills, skillStatus, stageCompletion } = useSkillStatus(projectId);
  const completedCount = Object.values(skillStatus).filter((s) => s === 'completed').length;
  const scoring = useMemo(() => scoreOverall(skills), [skills]);

  const storageKey = `sidebar-collapsed-${projectId}`;
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [activeSkill, setActiveSkill] = useState<SkillDef | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setCollapsed(JSON.parse(saved));
    } catch { /* ignore */ }
  }, [storageKey]);

  function toggleStage(num: number) {
    setCollapsed((prev) => {
      const next = { ...prev, [num]: !prev[num] };
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }

  function isActive(route: string) {
    const path = route.split('?')[0];
    return pathname?.includes(`/project/${projectId}/${path}`);
  }

  function statusDot(status: string | undefined) {
    if (status === 'completed') {
      return <span className="w-3.5 h-3.5 rounded-full bg-moss-wash text-moss flex items-center justify-center text-[9px] font-bold">+</span>;
    }
    if (status === 'stale') {
      return <span className="w-3.5 h-3.5 rounded-full bg-accent-wash text-accent flex items-center justify-center text-[9px] font-bold">!</span>;
    }
    return <span className="w-3.5 h-3.5 rounded-full border border-line-2" />;
  }

  function handleSkillClick(skill: SkillDef, e: React.MouseEvent) {
    const status = skillStatus[skill.id];
    if (status === 'completed') {
      e.preventDefault();
      setActiveSkill(skill);
    }
    // If not completed, the Link navigates to chat?skill= as normal
  }

  return (
    <>
      <aside className="w-56 shrink-0 bg-surface-sunk border-r border-line flex flex-col h-full">
        {/* Project header */}
        <div className="px-4 py-4 border-b border-line">
          <Link href="/" className="text-xs text-ink-5 hover:text-ink-4 transition-colors">
            &larr; Projects
          </Link>
          {projectName && (
            <h2 className="text-sm font-medium text-ink-2 mt-2 truncate" title={projectName}>
              {projectName}
            </h2>
          )}
        </div>

        {/* Primary nav — grouped. Dashboard is the default landing surface
            (aggregates ecosystem + inbox + budget + metrics + the floating
            chat drawer). Brief + Inbox are dedicated detail views for the
            weekly cadence. Workspace is the full chat page. */}
        <div className="px-2 pt-3 pb-1 space-y-0.5">
          {/* Group: the founder's home */}
          <Link
            href={`/project/${projectId}/dashboard`}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
              isActive('dashboard')
                ? 'bg-paper-2 text-ink'
                : 'text-ink-3 hover:bg-paper hover:text-ink'
            }`}
          >
            <span className="w-4 text-center text-xs">◇</span>
            <span>Dashboard</span>
          </Link>

          {/* Group: this week (ecosystem cadence) */}
          <div className="pt-2 pb-1 px-2.5 text-[10px] uppercase tracking-wider text-ink-6">
            Questa settimana
          </div>
          <Link
            href={`/project/${projectId}/brief`}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
              isActive('brief')
                ? 'bg-paper-2 text-ink'
                : 'text-ink-3 hover:bg-paper hover:text-ink'
            }`}
          >
            <span className="w-4 text-center text-xs">B</span>
            <span>Monday Brief</span>
          </Link>
          <Link
            href={`/project/${projectId}/actions`}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
              isActive('actions')
                ? 'bg-paper-2 text-ink'
                : 'text-ink-3 hover:bg-paper hover:text-ink'
            }`}
          >
            <span className="w-4 text-center text-xs">I</span>
            <span>Inbox</span>
          </Link>

          {/* Group: workspace + output */}
          <div className="pt-2 pb-1 px-2.5 text-[10px] uppercase tracking-wider text-ink-6">
            Workspace
          </div>
          <Link
            href={`/project/${projectId}/chat`}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
              isActive('chat')
                ? 'bg-paper-2 text-ink'
                : 'text-ink-3 hover:bg-paper hover:text-ink'
            }`}
          >
            <span className="w-4 text-center text-xs">/</span>
            <span>Chat</span>
          </Link>
          <Link
            href={`/project/${projectId}/drafts`}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
              isActive('drafts')
                ? 'bg-paper-2 text-ink'
                : 'text-ink-3 hover:bg-paper hover:text-ink'
            }`}
          >
            <span className="w-4 text-center text-xs">D</span>
            <span>Drafts</span>
          </Link>
          <Link
            href={`/project/${projectId}/usage`}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
              isActive('usage')
                ? 'bg-paper-2 text-ink'
                : 'text-ink-3 hover:bg-paper hover:text-ink'
            }`}
          >
            <span className="w-4 text-center text-xs">U</span>
            <span>Usage</span>
          </Link>
        </div>

        {/* 7 Stages */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {STAGES.map((stage) => {
            const colors = stageColors(stage.color);
            const completion = stageCompletion[stage.number] || { completed: 0, total: stage.skills.length };
            const isCollapsed = collapsed[stage.number] ?? false;
            const allDone = completion.completed === completion.total;

            return (
              <div key={stage.number}>
                <button
                  onClick={() => toggleStage(stage.number)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-paper group"
                >
                  <span className={`text-[10px] font-bold ${colors.text}`}>{stage.number}</span>
                  <span className={`flex-1 text-[11px] font-semibold uppercase tracking-wider ${
                    allDone ? 'text-moss/70' : colors.text
                  }`}>
                    {stage.name}
                  </span>
                  <span className="text-[10px] text-ink-6">
                    {completion.completed}/{completion.total}
                  </span>
                  <span className="text-[10px] text-ink-6 transition-transform" style={{
                    transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                  }}>
                    v
                  </span>
                </button>

                {!isCollapsed && (
                  <div className={`ml-1 pl-3 border-l-2 ${colors.border} space-y-0.5 pb-1`}>
                    {stage.skills.map((skill) => {
                      const status = skillStatus[skill.id];
                      const completed = status === 'completed';
                      return (
                        <Link
                          key={skill.id}
                          href={`/project/${projectId}/${skill.route}`}
                          onClick={(e) => handleSkillClick(skill, e)}
                          className={`flex items-center gap-2 px-2 py-1 rounded-md text-[13px] transition-colors group/skill ${
                            completed
                              ? 'text-ink-3 hover:bg-paper hover:text-ink'
                              : 'text-ink-5 hover:bg-paper hover:text-ink-3'
                          }`}
                        >
                          {statusDot(status)}
                          <span className="truncate flex-1">{skill.label}</span>
                          {completed && (
                            <span className="text-[10px] text-ink-6 opacity-0 group-hover/skill:opacity-100 transition-opacity">
                              View
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Readiness footer — skill-scoring radar (moved from /intelligence
            so /intelligence can host the new knowledge-graph view). */}
        <Link href={`/project/${projectId}/readiness`} className="block px-4 py-3 border-t border-line hover:bg-paper transition-colors">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-ink-5 uppercase tracking-wider">Readiness</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-ink-3">{scoring.score.toFixed(1)}/10</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                scoring.score >= 8 ? 'bg-moss-wash text-moss'
                : scoring.score >= 6 ? 'bg-moss/20 text-moss'
                : scoring.score >= 4 ? 'bg-accent-wash text-accent'
                : 'bg-clay/20 text-clay'
              }`}>
                {scoring.verdict}
              </span>
            </div>
          </div>
          <div className="w-full h-1.5 bg-paper-2 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(scoring.score / 10) * 100}%`,
                background: scoring.score < 3
                  ? '#ef4444'
                  : scoring.score < 6
                    ? '#f59e0b'
                    : scoring.score < 8
                      ? '#3b82f6'
                      : '#10b981',
              }}
            />
          </div>
          <div className="text-[10px] text-ink-6 mt-2">View all stages &rarr;</div>
        </Link>
      </aside>

      {/* Skill Detail Panel */}
      {activeSkill && (
        <SkillDetailPanel
          skill={activeSkill}
          data={skills[activeSkill.id] || { status: 'not_run' }}
          projectId={projectId}
          skillStatus={skillStatus}
          onClose={() => setActiveSkill(null)}
        />
      )}
    </>
  );
}
