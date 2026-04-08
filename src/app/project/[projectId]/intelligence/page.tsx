'use client';

import { use, useState, useMemo } from 'react';
import Link from 'next/link';
import { STAGES, stageColors, SKILL_KICKOFFS, SKILL_NEXT_STEPS, SKILL_SOURCES } from '@/lib/stages';
import { useSkillStatus } from '@/hooks/useSkillStatus';
import { scoreOverall } from '@/lib/scoring';
import { extractSkillHighlights } from '@/lib/extract-summary';
import { GaugeChart, RadarChart } from '@/components/charts';

function verdictStyle(v: string) {
  if (v === 'STRONG GO') return 'bg-green-500/20 text-green-400';
  if (v === 'GO') return 'bg-emerald-500/20 text-emerald-400';
  if (v === 'CAUTION') return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-red-500/20 text-red-400';
}

export default function IntelligencePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { skills, skillStatus, stageCompletion, loading } = useSkillStatus(projectId);
  const [openStage, setOpenStage] = useState<number | null>(null);

  const scoring = useMemo(() => scoreOverall(skills), [skills]);

  const completedCount = STAGES.flatMap(s => s.skills).filter(s => skillStatus[s.id] === 'completed').length;
  const totalCount = STAGES.flatMap(s => s.skills).length;

  const radarData = STAGES.map(s => ({
    subject: s.name.replace(' & ', '/'),
    value: scoring.stages[s.number]?.score || 0,
  }));

  if (loading) return <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Loading...</div>;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Compact header */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4 mb-6">
          {/* Score + recommendations */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold text-white">{scoring.score.toFixed(1)}</span>
                <span className="text-sm text-zinc-500">/10</span>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${verdictStyle(scoring.verdict)}`}>
                {scoring.verdict}
              </span>
              <span className="text-xs text-zinc-600 ml-auto">{completedCount}/{totalCount} steps</span>
            </div>

            {/* Top recommendations */}
            {scoring.recommendations.length > 0 && (
              <div className="space-y-1.5">
                {scoring.recommendations.slice(0, 3).map((rec, i) => (
                  <div key={i} className="flex gap-2 text-sm text-zinc-400">
                    <span className="text-yellow-500 shrink-0">&rarr;</span>
                    <span>{rec}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Compact radar */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
            <RadarChart data={radarData} height={200} />
          </div>
        </div>

        {/* Stage cards */}
        <div className="space-y-3">
          {STAGES.map((stage) => {
            const colors = stageColors(stage.color);
            const ss = scoring.stages[stage.number];
            const comp = stageCompletion[stage.number] || { completed: 0, total: stage.skills.length };
            const isOpen = openStage === stage.number;
            const hasCompleted = comp.completed > 0;

            return (
              <div key={stage.number} className={`border ${colors.border} rounded-xl overflow-hidden`}>
                {/* Stage header — always visible */}
                <button
                  onClick={() => setOpenStage(isOpen ? null : stage.number)}
                  className={`w-full px-5 py-3 flex items-center gap-3 text-left transition ${hasCompleted ? colors.bg : 'bg-zinc-900/30'} hover:brightness-110`}
                >
                  <span className={`text-sm font-bold ${hasCompleted ? colors.text : 'text-zinc-600'}`}>{stage.number}</span>
                  <span className={`text-sm font-semibold flex-1 ${hasCompleted ? colors.text : 'text-zinc-600'}`}>{stage.name}</span>
                  <span className="text-lg font-bold text-white">{(ss?.score || 0).toFixed(1)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${verdictStyle(ss?.verdict || 'NOT READY')}`}>
                    {ss?.verdict || 'NOT READY'}
                  </span>
                  <span className="text-[10px] text-zinc-600">{comp.completed}/{comp.total}</span>
                  <span className="text-xs text-zinc-600">{isOpen ? 'v' : '>'}</span>
                </button>

                {/* Expanded content */}
                {isOpen && (
                  <div className="px-5 py-4 bg-zinc-950/50 space-y-4">
                    {/* Stage recommendations */}
                    {ss.recommendations.length > 0 && (
                      <div className="space-y-1">
                        {ss.recommendations.map((r, i) => (
                          <div key={i} className="flex gap-2 text-xs text-yellow-500/80">
                            <span>&rarr;</span><span>{r}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Per-skill cards */}
                    {stage.skills.map((skill) => {
                      const data = skills[skill.id];
                      const isCompleted = data?.status === 'completed';
                      const highlights = isCompleted ? extractSkillHighlights(data?.summary) : null;
                      const sources = SKILL_SOURCES[skill.id];
                      const nextSteps = SKILL_NEXT_STEPS[skill.id] || [];

                      if (!isCompleted) {
                        return (
                          <div key={skill.id} className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/30">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-zinc-500">{skill.label}</span>
                              <Link
                                href={`/project/${projectId}/${skill.route}`}
                                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                              >
                                Run {skill.label}
                              </Link>
                            </div>
                          </div>
                        );
                      }

                      const skillScore = ss?.skills[skill.id];
                      return (
                        <div key={skill.id} className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/30 space-y-3">
                          {/* Skill header */}
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-zinc-200 flex-1">{skill.label}</span>
                            <span className="text-sm font-bold text-white">{(skillScore?.total || 0).toFixed(1)}/10</span>
                          </div>

                          {/* Key take */}
                          {highlights?.keyTake && (
                            <p className="text-sm text-zinc-400 leading-relaxed">{highlights.keyTake}</p>
                          )}

                          {/* Metrics */}
                          {highlights && highlights.metrics.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {highlights.metrics.map((m, mi) => (
                                <span key={mi} className="text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-full border border-blue-500/20">
                                  {m}
                                </span>
                              ))}
                              {highlights.verdict && (
                                <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20">
                                  {highlights.verdict}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Strengths + Weaknesses */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {highlights && highlights.strengths.length > 0 && (
                              <div>
                                <div className="text-[10px] text-green-500 font-semibold uppercase tracking-wider mb-1">Strengths</div>
                                {highlights.strengths.map((s, si) => (
                                  <div key={si} className="flex gap-1.5 text-xs text-zinc-400 mb-0.5">
                                    <span className="text-green-500 shrink-0">+</span>
                                    <span>{s}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {highlights && highlights.weaknesses.length > 0 && (
                              <div>
                                <div className="text-[10px] text-red-400 font-semibold uppercase tracking-wider mb-1">Risks / Gaps</div>
                                {highlights.weaknesses.map((w, wi) => (
                                  <div key={wi} className="flex gap-1.5 text-xs text-zinc-400 mb-0.5">
                                    <span className="text-red-400 shrink-0">-</span>
                                    <span>{w}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Sources */}
                          {sources && sources.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] text-zinc-600">Sources:</span>
                              {sources.map(srcId => {
                                const done = skillStatus[srcId] === 'completed';
                                const label = STAGES.flatMap(s => s.skills).find(s => s.id === srcId)?.label || srcId;
                                return (
                                  <span key={srcId} className={`text-[10px] px-1.5 py-0.5 rounded-full ${done ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700/50 text-zinc-500'}`}>
                                    {label} {done ? '+' : '-'}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          {/* Action buttons */}
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Link
                              href={`/project/${projectId}/${skill.route}`}
                              className="text-[11px] px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors"
                            >
                              Re-run
                            </Link>
                            {nextSteps.slice(0, 2).map(ns => (
                              <Link
                                key={ns.skillId}
                                href={`/project/${projectId}/chat?skill=${ns.skillId}&t=${Date.now()}`}
                                className="text-[11px] px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg transition-colors border border-blue-500/20"
                              >
                                {ns.label}
                              </Link>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
