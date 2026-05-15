'use client';

import { use, useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { STAGES, stageColors, SKILL_KICKOFFS, SKILL_NEXT_STEPS, SKILL_SOURCES } from '@/lib/stages';
import { useSkillStatus } from '@/hooks/useSkillStatus';
import { scoreOverall } from '@/lib/scoring';
import { extractSkillHighlights } from '@/lib/extract-summary';
import { GaugeChart, RadarChart } from '@/components/charts';
import type { Source } from '@/types/artifacts';
import type { SectionScore } from '@/lib/section-scoring';
import SourcesFooter from '@/components/chat/artifacts/SourcesFooter';

// ─── Risk audit widget (roadmap 1.1) ─────────────────────────────────────────

interface Risk {
  id: string;
  dimension: string;
  risk: string;
  probability?: number;
  impact?: number;
  risk_score?: number;
  severity?: string;
  narrative?: string;
  mitigation?: string;
  mitigation_owner?: string;
  mitigation_due?: string;
  // Per-risk sources — required by the skill schema (Phase C) but may be
  // absent in audits generated before the citation requirement landed.
  sources?: Source[];
}

// Watch-list items: the old schema used `string[]`, the Phase-C schema uses
// `{ signal, sources }[]`. Union to handle both — older audits still render.
type WatchItem = string | { signal: string; sources?: Source[] };

interface RiskAudit {
  risks?: Risk[];
  risk_scenarios?: Risk[]; // skill variants
  critical_count?: number;
  high_count?: number;
  overall_assessment?: string;
  watch_list?: WatchItem[];
  next_review_date?: string;
  dimension_summary?: Record<string, { risk_count: number; max_score: number }>;
  // Top-level sources — skill-wide provenance for the whole audit.
  sources?: Source[];
}

function severityStyle(sev?: string) {
  const s = (sev ?? '').toLowerCase();
  if (s === 'critical') return 'bg-clay/20 text-clay';
  if (s === 'high') return 'bg-orange-500/20 text-orange-400';
  if (s === 'medium') return 'bg-accent/20 text-accent';
  return 'bg-ink-5/20 text-ink-4';
}

function RiskAuditCard({ projectId }: { projectId: string }) {
  const [audit, setAudit] = useState<RiskAudit | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load any existing audit on mount.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/risk-analysis/${projectId}`).then(async (res) => {
      if (cancelled) return;
      if (res.status === 404) return; // no audit yet
      if (!res.ok) return;
      const body = await res.json();
      const data = body?.data ?? body;
      if (data?.audit) {
        setAudit(data.audit);
        setGeneratedAt(data.generated_at ?? null);
      }
    }).catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [projectId]);

  async function runAudit() {
    setRunning(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/risk-analysis/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
      const data = body?.data ?? body;
      setAudit(data);
      setGeneratedAt(new Date().toISOString());
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  // Skill output can come back under either `risks` or `risk_scenarios`
  // depending on the LLM's interpretation of the schema. Accept both.
  const risks: Risk[] = audit?.risks ?? audit?.risk_scenarios ?? [];
  const topRisks = [...risks]
    .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0))
    .slice(0, 6);

  return (
    <div className="bg-paper border border-line rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Risk Audit</h3>
          <p className="text-xs text-ink-5 mt-0.5">
            {risks.length > 0
              ? `${risks.length} risks identified${generatedAt ? ` · ${new Date(generatedAt).toLocaleString()}` : ''}`
              : 'Run a structured audit across market, technical, regulatory, team, financial dimensions.'}
          </p>
        </div>
        <button
          onClick={runAudit}
          disabled={running}
          className="text-xs px-3 py-1.5 bg-moss hover:bg-moss disabled:opacity-50 text-white rounded-md transition-colors"
        >
          {running ? 'Auditing...' : risks.length > 0 ? 'Re-run' : 'Run audit'}
        </button>
      </div>

      {errorMsg && <div className="text-xs text-clay mb-2">Error: {errorMsg}</div>}

      {audit?.overall_assessment && (
        <p className="text-xs text-ink-4 mb-3 italic">{audit.overall_assessment}</p>
      )}

      {topRisks.length > 0 && (
        <div className="space-y-1.5">
          {topRisks.map((r) => (
            <div
              key={r.id ?? r.risk}
              className="p-2 rounded bg-paper-2/50 border border-line"
            >
              <div className="flex items-start gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono uppercase shrink-0 ${severityStyle(r.severity)}`}>
                  {r.severity ?? '—'}
                </span>
                <span className="text-[10px] text-ink-5 uppercase shrink-0 w-20 pt-0.5">{r.dimension}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-ink">{r.risk}</div>
                  {r.mitigation && (
                    <div className="text-[11px] text-ink-4 mt-0.5">
                      <span className="text-ink-5">mitigate:</span> {r.mitigation}
                      {r.mitigation_owner && <span className="text-ink-5"> · {r.mitigation_owner}</span>}
                    </div>
                  )}
                </div>
                {typeof r.risk_score === 'number' && (
                  <span className="text-[11px] text-ink-5 font-mono shrink-0">{r.risk_score}</span>
                )}
              </div>
              {/* Per-risk sources — compact mode to fit inside the tight row. */}
              {r.sources && r.sources.length > 0 && (
                <SourcesFooter sources={r.sources} compact />
              )}
            </div>
          ))}
        </div>
      )}

      {audit?.watch_list && audit.watch_list.length > 0 && (
        <div className="mt-3 pt-3 border-t border-line">
          <div className="text-[11px] text-ink-5 uppercase mb-1">Watch list</div>
          <ul className="space-y-0.5">
            {audit.watch_list.slice(0, 3).map((w, i) => {
              // Handle both old (string) and new ({signal, sources}) shapes.
              const signal = typeof w === 'string' ? w : w.signal;
              const sources = typeof w === 'string' ? undefined : w.sources;
              return (
                <li key={i} className="text-xs text-ink-4">
                  <div className="flex gap-2">
                    <span className="text-ink-6 shrink-0">·</span>
                    <span>{signal}</span>
                  </div>
                  {sources && sources.length > 0 && (
                    <div className="ml-4">
                      <SourcesFooter sources={sources} compact />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Skill-wide sources (top-level provenance for the audit as a whole). */}
      {audit?.sources && audit.sources.length > 0 && (
        <SourcesFooter sources={audit.sources} label="Audit sources" />
      )}
    </div>
  );
}

// ─── Section scores grid ──────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 7) return 'text-moss';
  if (score >= 5) return 'text-accent';
  return 'text-clay';
}

function scoreBarColor(score: number): string {
  if (score >= 7) return 'bg-moss';
  if (score >= 5) return 'bg-accent';
  return 'bg-clay';
}

function SectionScoresGrid({ sections }: { sections: SectionScore[] }) {
  if (!sections || sections.length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
      {sections.map((s) => (
        <div
          key={s.key}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-paper-2/40 border border-line"
        >
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-ink-4 truncate">{s.label}</div>
            <div className="h-1 mt-1 rounded-full bg-paper-3/50 overflow-hidden">
              {s.available && (
                <div
                  className={`h-full rounded-full ${scoreBarColor(s.score)} transition-all`}
                  style={{ width: `${(s.score / 10) * 100}%` }}
                />
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {s.available ? (
              <>
                <span className={`text-sm font-bold ${scoreColor(s.score)}`}>
                  {s.score.toFixed(1)}
                </span>
                {s.fallback && (
                  <span className="text-[9px] text-ink-6 font-mono">est.</span>
                )}
              </>
            ) : (
              <span className="text-sm text-ink-6">—</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Section data hook ────────────────────────────────────────────────────────

interface StageSections {
  [stageNumber: number]: SectionScore[];
}

function useSectionData(projectId: string) {
  const [data, setData] = useState<StageSections>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/readiness`);
      if (!res.ok) return;
      const body = await res.json();
      const readiness = body?.data;
      if (!readiness?.stages) return;
      const map: StageSections = {};
      for (const stage of readiness.stages) {
        if (stage.sections) {
          map[stage.number] = stage.sections;
        }
      }
      setData(map);
    } catch {
      // Non-fatal — sections are supplementary
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  return data;
}

// ─── Verdict style ────────────────────────────────────────────────────────────

function verdictStyle(v: string) {
  if (v === 'STRONG GO') return 'bg-moss/20 text-moss';
  if (v === 'GO') return 'bg-emerald-500/20 text-emerald-400';
  if (v === 'CAUTION') return 'bg-accent/20 text-accent';
  return 'bg-clay/20 text-clay';
}

export default function IntelligencePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { skills, skillStatus, stageCompletion, loading } = useSkillStatus(projectId);
  const [openStage, setOpenStage] = useState<number | null>(null);
  const sectionData = useSectionData(projectId);

  const scoring = useMemo(() => scoreOverall(skills), [skills]);

  const completedCount = STAGES.flatMap(s => s.skills).filter(s => skillStatus[s.id] === 'completed').length;
  const totalCount = STAGES.flatMap(s => s.skills).length;

  const radarData = STAGES.map(s => ({
    subject: s.name.replace(' & ', '/'),
    value: scoring.stages[s.number]?.score || 0,
  }));

  if (loading) return <div className="flex items-center justify-center h-full text-ink-5 text-sm">Loading...</div>;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Compact header */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4 mb-6">
          {/* Score + recommendations */}
          <div className="bg-paper border border-line rounded-xl p-5">
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold text-white">{scoring.score.toFixed(1)}</span>
                <span className="text-sm text-ink-5">/10</span>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${verdictStyle(scoring.verdict)}`}>
                {scoring.verdict}
              </span>
              <span className="text-xs text-ink-6 ml-auto">{completedCount}/{totalCount} steps</span>
            </div>

            {/* Top recommendations */}
            {scoring.recommendations.length > 0 && (
              <div className="space-y-1.5">
                {scoring.recommendations.slice(0, 3).map((rec, i) => (
                  <div key={i} className="flex gap-2 text-sm text-ink-4">
                    <span className="text-accent shrink-0">&rarr;</span>
                    <span>{rec}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Compact radar */}
          <div className="bg-paper border border-line rounded-xl p-3">
            <RadarChart data={radarData} height={200} />
          </div>
        </div>

        {/* Risk audit (roadmap 1.1) */}
        <RiskAuditCard projectId={projectId} />

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
                  className={`w-full px-5 py-3 flex items-center gap-3 text-left transition ${hasCompleted ? colors.bg : 'bg-paper/30'} hover:brightness-110`}
                >
                  <span className={`text-sm font-bold ${hasCompleted ? colors.text : 'text-ink-6'}`}>{stage.number}</span>
                  <span className={`text-sm font-semibold flex-1 ${hasCompleted ? colors.text : 'text-ink-6'}`}>{stage.name}</span>
                  <span className="text-lg font-bold text-white">{(ss?.score || 0).toFixed(1)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${verdictStyle(ss?.verdict || 'NOT READY')}`}>
                    {ss?.verdict || 'NOT READY'}
                  </span>
                  <span className="text-[10px] text-ink-6">{comp.completed}/{comp.total}</span>
                  <span className="text-xs text-ink-6">{isOpen ? 'v' : '>'}</span>
                </button>

                {/* Expanded content */}
                {isOpen && (
                  <div className="px-5 py-4 bg-surface-sunk/50 space-y-4">
                    {/* Stage recommendations */}
                    {ss.recommendations.length > 0 && (
                      <div className="space-y-1">
                        {ss.recommendations.map((r, i) => (
                          <div key={i} className="flex gap-2 text-xs text-accent/80">
                            <span>&rarr;</span><span>{r}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Section scores grid */}
                    {sectionData[stage.number] && sectionData[stage.number].length > 0 && (
                      <SectionScoresGrid sections={sectionData[stage.number]} />
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
                          <div key={skill.id} className="border border-line rounded-lg p-4 bg-paper/30">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-ink-5">{skill.label}</span>
                              <Link
                                href={`/project/${projectId}/${skill.route}`}
                                className="text-xs px-3 py-1.5 bg-moss hover:bg-moss text-white rounded-lg transition-colors"
                              >
                                Run {skill.label}
                              </Link>
                            </div>
                          </div>
                        );
                      }

                      const skillScore = ss?.skills[skill.id];
                      return (
                        <div key={skill.id} className="border border-line rounded-lg p-4 bg-paper/30 space-y-3">
                          {/* Skill header */}
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-ink-2 flex-1">{skill.label}</span>
                            <span className="text-sm font-bold text-white">{(skillScore?.total || 0).toFixed(1)}/10</span>
                          </div>

                          {/* Key take */}
                          {highlights?.keyTake && (
                            <p className="text-sm text-ink-4 leading-relaxed">{highlights.keyTake}</p>
                          )}

                          {/* Metrics */}
                          {highlights && highlights.metrics.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {highlights.metrics.map((m, mi) => (
                                <span key={mi} className="text-[10px] px-2 py-0.5 bg-moss/10 text-moss rounded-full border border-moss/20">
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
                                <div className="text-[10px] text-moss font-semibold uppercase tracking-wider mb-1">Strengths</div>
                                {highlights.strengths.map((s, si) => (
                                  <div key={si} className="flex gap-1.5 text-xs text-ink-4 mb-0.5">
                                    <span className="text-moss shrink-0">+</span>
                                    <span>{s}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {highlights && highlights.weaknesses.length > 0 && (
                              <div>
                                <div className="text-[10px] text-clay font-semibold uppercase tracking-wider mb-1">Risks / Gaps</div>
                                {highlights.weaknesses.map((w, wi) => (
                                  <div key={wi} className="flex gap-1.5 text-xs text-ink-4 mb-0.5">
                                    <span className="text-clay shrink-0">-</span>
                                    <span>{w}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Sources */}
                          {sources && sources.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] text-ink-6">Sources:</span>
                              {sources.map(srcId => {
                                const done = skillStatus[srcId] === 'completed';
                                const label = STAGES.flatMap(s => s.skills).find(s => s.id === srcId)?.label || srcId;
                                return (
                                  <span key={srcId} className={`text-[10px] px-1.5 py-0.5 rounded-full ${done ? 'bg-moss/20 text-moss' : 'bg-paper-3/50 text-ink-5'}`}>
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
                              className="text-[11px] px-3 py-1.5 bg-paper-2 hover:bg-paper-3 text-ink-3 rounded-lg transition-colors"
                            >
                              Re-run
                            </Link>
                            {nextSteps.slice(0, 2).map(ns => (
                              <Link
                                key={ns.skillId}
                                href={`/project/${projectId}/chat?skill=${ns.skillId}&t=${Date.now()}`}
                                className="text-[11px] px-3 py-1.5 bg-moss/20 hover:bg-moss/30 text-moss rounded-lg transition-colors border border-moss/20"
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
