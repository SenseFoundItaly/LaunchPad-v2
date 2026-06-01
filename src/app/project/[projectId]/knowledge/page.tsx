'use client';

/**
 * Knowledge — the read-only mirror of everything the system understands
 * about this project. The idea canvas, market research, competitors, applied
 * memory facts, mapped entities, active briefs, and recent skill outputs all
 * land here in one scrollable page.
 *
 * Read-only by design. The chat skills + Save-to-knowledge are the canonical
 * write paths; this page is the founder's view of what those have produced.
 */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopBar, NavRail } from '@/components/design/chrome';
import { Pill, StatusBar, Icon, I } from '@/components/design/primitives';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';

// ---------------------------------------------------------------------------
// Local types — mirror what /api/projects/{p}/overview returns
// ---------------------------------------------------------------------------

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  current_step: number | null;
  locale: string | null;
}

interface IdeaRow {
  problem: string | null;
  solution: string | null;
  target_market: string | null;
  business_model: string | null;
  competitive_advantage: string | null;
  value_proposition: string | null;
  unfair_advantage: string | null;
  updated_at: string | null;
}

interface ResearchPayload {
  market_size: unknown;
  trends: unknown;
  key_insights: unknown;
  case_studies: unknown;
  researched_at: string | null;
}

interface ScoreRow {
  overall_score: number | null;
  benchmark: string | null;
  recommendation: string | null;
}

interface SkillStub { id: string; label: string }

interface StageReadiness {
  number: number;
  name: string;
  score: number;
  verdict: 'STRONG GO' | 'GO' | 'CAUTION' | 'NOT READY';
  skills_total: number;
  skills_completed: number;
  skills_stale: number;
  missing_skills: SkillStub[];
  stale_skills: SkillStub[];
}

interface ProjectReadiness {
  overall_score: number;
  overall_verdict: 'STRONG GO' | 'GO' | 'CAUTION' | 'NOT READY';
  stages: StageReadiness[];
  next_recommended_skill:
    | (SkillStub & { stage_number: number; stage_name: string; kickoff: string })
    | null;
}

interface CompetitorEntry {
  name: string;
  summary: string | null;
  source: 'research' | 'graph';
}

// Mirrors src/types/artifacts.ts Source — kept inline so the Knowledge page
// has zero imports from the artifact pipeline. Each kind renders differently
// in the SourceChain audit row (issue #22).
type FactSource =
  | { type: 'web'; title: string; url: string; accessed_at?: string; quote?: string }
  | { type: 'skill'; title: string; skill_id: string; run_id?: string; quote?: string }
  | {
      type: 'internal';
      title: string;
      ref: 'graph_node' | 'score' | 'research' | 'memory_fact' | 'chat_turn';
      ref_id: string;
      quote?: string;
    }
  | { type: 'user'; title: string; chat_turn_id?: string; quote: string }
  | { type: 'inference'; title: string; based_on: FactSource[]; reasoning: string };

interface FactRow {
  id: string;
  fact: string;
  kind: string;
  source_type: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
  /** JSONB column from memory_facts. Provenance chain — every source that
   *  contributed evidence for this fact. Rendered by SourceChain. */
  sources?: FactSource[] | null;
}

interface GraphNodeRow {
  id: string;
  name: string;
  node_type: string;
  summary: string | null;
}

interface BriefSummary {
  id: string;
  title: string;
  entity_name: string | null;
  confidence: number;
  narrative: string | null;
}

interface SkillCompletionRow {
  skill_id: string;
  status: string;
  summary: string | null;
  completed_at: string;
}

interface GapRow {
  id: string;
  kind: string;
  label: string;
  why: string;
  fill_skill: string | null;
  fill_kickoff: string;
  stage_number: number | null;
  severity: number;
}

interface OverviewPayload {
  project: ProjectRow | null;
  score: ScoreRow | null;
  readiness: ProjectReadiness | null;
  gaps: GapRow[];
  idea: IdeaRow | null;
  research: ResearchPayload | null;
  competitors: CompetitorEntry[];
  facts: FactRow[];
  entities: GraphNodeRow[];
  briefs: BriefSummary[];
  skill_completions: SkillCompletionRow[];
  failedSections: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FACT_KIND_LABEL: Record<string, string> = {
  decision: 'Decisions',
  observation: 'Observations',
  preference: 'Preferences',
  note: 'Notes',
  fact: 'Facts',
};

const FACT_KIND_ORDER = ['decision', 'observation', 'preference', 'note', 'fact'];

/** Pick the load-bearing items for the "Top of mind" surface:
 *   - The highest-confidence active brief (1)
 *   - Up to 3 decisions with confidence >= 0.7, recency tiebreaker
 *  Falls back to top observations only if no qualifying decisions exist —
 *  but observations don't get a free pass; they need confidence >= 0.9. */
function pickTopOfMind(
  facts: FactRow[],
  briefs: BriefSummary[],
): { brief: BriefSummary | null; decisions: FactRow[] } {
  const brief = briefs.length === 0
    ? null
    : briefs.reduce((acc, b) => (b.confidence > acc.confidence ? b : acc));

  const decisions = facts
    .filter((f) => f.kind === 'decision' && f.confidence >= 0.7)
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    })
    .slice(0, 3);

  if (decisions.length === 0) {
    // No firm decisions — fall back to the strongest observations so the
    // section still anchors something, but only if confidence is high.
    const strongObservations = facts
      .filter((f) => f.kind === 'observation' && f.confidence >= 0.9)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 2);
    return { brief, decisions: strongObservations };
  }

  return { brief, decisions };
}

const NODE_TYPE_LABEL: Record<string, string> = {
  market_segment: 'Market segments',
  persona: 'Personas',
  technology: 'Technologies',
  trend: 'Trends',
  partner: 'Partners',
  customer: 'Customers',
  channel: 'Channels',
};

const IDEA_FIELDS: Array<{ key: keyof IdeaRow; label: string }> = [
  { key: 'problem', label: 'Problem' },
  { key: 'solution', label: 'Solution' },
  { key: 'target_market', label: 'Target market' },
  { key: 'value_proposition', label: 'Value proposition' },
  { key: 'competitive_advantage', label: 'Competitive advantage' },
  { key: 'unfair_advantage', label: 'Unfair advantage' },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function KnowledgePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);

  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/overview`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.success === false) throw new Error(body.error || 'Failed to load');
      setData(body.data as OverviewPayload);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refetch();
    // Listen for the project's universal inbox-dirty pub-sub so the page
    // refreshes when a fact gets approved in another tab, or when a brief is
    // saved to knowledge. Mirrors the same pattern in `useInbox.ts`.
    const onChange = () => { void refetch(); };
    window.addEventListener('lp-actions-changed', onChange);
    return () => window.removeEventListener('lp-actions-changed', onChange);
  }, [refetch]);

  const project = data?.project ?? null;
  const facts = data?.facts ?? [];
  const competitors = data?.competitors ?? [];
  const entities = data?.entities ?? [];
  const briefs = data?.briefs ?? [];
  const skills = data?.skill_completions ?? [];

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Project', 'Knowledge']}
        right={
          data?.score?.overall_score != null ? (
            <Pill kind="info">score {data.score.overall_score.toFixed(1)}</Pill>
          ) : null
        }
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="knowledge" inboxBadge={inboxBadge} />

        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading && !data ? (
            <CenterMessage text="Loading…" />
          ) : error ? (
            <CenterMessage text={`Couldn't load this project's knowledge: ${error}`} kind="error" />
          ) : !project ? (
            <CenterMessage text="Project not found." kind="error" />
          ) : (
            <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 24px 64px', display: 'flex', flexDirection: 'column', gap: 28 }}>
              {/* 1. Project header */}
              <ProjectHeader project={project} score={data?.score ?? null} readiness={data?.readiness ?? null} />

              {/* 1a. Knowledge gaps — "what's missing right now". Lives above
                  stage progress because it's the most actionable view: each
                  row links straight to the chat with a kickoff pre-loaded. */}
              {(data?.gaps?.length ?? 0) > 0 && (
                <Section
                  label="Knowledge gaps"
                  sub={`${data!.gaps.length} ${data!.gaps.length === 1 ? 'gap' : 'gaps'} blocking progress`}
                  icon={I.signal}
                >
                  <GapsSection gaps={data!.gaps} projectId={projectId} />
                </Section>
              )}

              {/* 1ab. Top of mind — "what's settled and load-bearing". The
                  complement to Gaps: gaps = absences, this = anchors. Shows
                  the highest-confidence active brief + the top decisions
                  the agent is reasoning from. Only rendered when there's
                  something to anchor — silent on brand-new projects. */}
              {(() => {
                const top = pickTopOfMind(facts, briefs);
                if (!top.brief && top.decisions.length === 0) return null;
                return (
                  <Section
                    label="Top of mind"
                    sub="What's settled — the agent reasons from these"
                    icon={I.sparkles}
                  >
                    <TopOfMindSection top={top} projectId={projectId} />
                  </Section>
                );
              })()}

              {/* 1b. Stage progress — the 7-stage Solve flow with per-stage scores */}
              {data?.readiness && (
                <Section
                  label="Stage progress"
                  sub={`overall ${data.readiness.overall_score.toFixed(1)} / 10 · ${data.readiness.overall_verdict.toLowerCase()}`}
                  icon={I.tickets}
                >
                  <StagesSection readiness={data.readiness} projectId={projectId} />
                </Section>
              )}

              {/* 2. The Idea */}
              <Section
                label="The Idea"
                sub="What we're building, for whom, and why"
                icon={I.sparkles}
              >
                <IdeaSection idea={data?.idea ?? null} projectId={projectId} />
              </Section>

              {/* 3. The Market */}
              <Section
                label="The Market"
                sub="What the landscape looks like"
                icon={I.graph}
              >
                <MarketSection research={data?.research ?? null} projectId={projectId} />
              </Section>

              {/* 4. Competitors */}
              <Section
                label="Competitors"
                sub={competitors.length > 0 ? `${competitors.length} mapped` : undefined}
                icon={I.signal}
              >
                <CompetitorsSection competitors={competitors} projectId={projectId} />
              </Section>

              {/* 5. What we know about you */}
              <Section
                label="What we know"
                sub={facts.length > 0 ? `${facts.length} confirmed insights` : undefined}
                icon={I.chat}
              >
                <FactsSection facts={facts} projectId={projectId} />
              </Section>

              {/* 6. Entities & graph (only render if non-empty) */}
              {entities.length > 0 && (
                <Section label="Entities" sub={`${entities.length} mapped`} icon={I.graph}>
                  <EntitiesSection entities={entities} />
                </Section>
              )}

              {/* 7. Active briefs (only render if non-empty) */}
              {briefs.length > 0 && (
                <Section label="Active briefs" sub={`${briefs.length} synthesis`} icon={I.sparkles}>
                  <BriefsSection briefs={briefs} projectId={projectId} />
                </Section>
              )}

              {/* 8. Skill outputs (only render if non-empty) */}
              {skills.length > 0 && (
                <Section label="Skill outputs" sub={`${skills.length} runs`} icon={I.clock}>
                  <SkillsSection skills={skills} />
                </Section>
              )}
            </div>
          )}
        </div>
      </div>

      <StatusBar
        heartbeatLabel="heartbeat · idle"
        gateway="pi-agent · anthropic"
        ctxLabel={
          data
            ? `ctx · ${facts.length} facts · ${entities.length} entities · ${competitors.length} competitors`
            : 'ctx · loading'
        }
        budget={data?.score?.overall_score != null ? `score · ${data.score.overall_score.toFixed(1)}` : 'score · —'}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper — consistent visual rhythm across the page
// ---------------------------------------------------------------------------

function Section({
  label,
  sub,
  icon,
  children,
}: {
  label: string;
  sub?: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {icon && <Icon d={icon} size={12} stroke={1.4} style={{ color: 'var(--ink-3)' }} />}
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ink-3)' }}>
          {label}
        </span>
        {sub && (
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
            {sub}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Project header
// ---------------------------------------------------------------------------

function ProjectHeader({ project, score, readiness }: { project: ProjectRow; score: ScoreRow | null; readiness: ProjectReadiness | null }) {
  return (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 18, borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 className="lp-serif" style={{ margin: 0, fontSize: 26, letterSpacing: -0.4, lineHeight: 1.1, color: 'var(--ink)' }}>
          {project.name}
        </h1>
        <Pill kind="n">{project.status}</Pill>
        {project.current_step != null && (
          <Pill kind="info">stage {project.current_step}/7</Pill>
        )}
        {readiness && (
          <Pill kind={verdictPillKind(readiness.overall_verdict)}>
            readiness · {readiness.overall_score.toFixed(1)}/10
          </Pill>
        )}
      </div>
      {project.description && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, maxWidth: 720 }}>
          {project.description}
        </p>
      )}
      {score && (score.benchmark || score.recommendation) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
          {score.benchmark && <Pill kind="n">benchmark · {score.benchmark}</Pill>}
          {score.recommendation && <Pill kind="ok">{score.recommendation}</Pill>}
        </div>
      )}
    </header>
  );
}

function verdictPillKind(verdict: ProjectReadiness['overall_verdict']): 'ok' | 'info' | 'warn' | 'n' {
  switch (verdict) {
    case 'STRONG GO': return 'ok';
    case 'GO': return 'info';
    case 'CAUTION': return 'warn';
    case 'NOT READY': return 'n';
  }
}

// ---------------------------------------------------------------------------
// Stages — 7-stage Solve flow with per-stage score, verdict, completion
// ---------------------------------------------------------------------------

function StagesSection({ readiness, projectId }: { readiness: ProjectReadiness; projectId: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Next-recommended-skill callout (only when there is one) */}
      {readiness.next_recommended_skill && (
        <Link
          href={`/project/${projectId}/chat`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--line))',
            borderRadius: 6,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <Icon d={I.sparkles} size={12} stroke={1.4} style={{ color: 'var(--accent)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Next recommended
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink)' }}>
              {readiness.next_recommended_skill.label}
              <span style={{ color: 'var(--ink-4)' }}> · Stage {readiness.next_recommended_skill.stage_number} ({readiness.next_recommended_skill.stage_name})</span>
            </div>
          </div>
          <Icon d={I.chevr} size={10} style={{ color: 'var(--ink-5)' }} />
        </Link>
      )}

      {/* 7 stage rows */}
      <div className="lp-card" style={{ padding: 0, overflow: 'hidden' }}>
        {readiness.stages.map((s, i) => (
          <StageRow key={s.number} stage={s} isFirst={i === 0} />
        ))}
      </div>
    </div>
  );
}

function StageRow({ stage, isFirst }: { stage: StageReadiness; isFirst: boolean }) {
  const pct = Math.round((stage.skills_completed / Math.max(1, stage.skills_total)) * 100);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderTop: isFirst ? 'none' : '1px solid var(--line)',
      }}
    >
      <span
        className="lp-mono"
        style={{
          fontSize: 10,
          color: 'var(--ink-5)',
          width: 22,
          flexShrink: 0,
          textAlign: 'right',
        }}
      >
        {stage.number}/7
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--ink)' }}>{stage.name}</span>
          <Pill kind={verdictPillKind(stage.verdict)}>{stage.verdict.toLowerCase()}</Pill>
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
            {stage.score.toFixed(1)}/10 · {stage.skills_completed}/{stage.skills_total} skills{stage.skills_stale > 0 ? ` · ${stage.skills_stale} stale` : ''}
          </span>
        </div>
        {/* Progress bar */}
        <div style={{ height: 4, background: 'var(--paper-3)', borderRadius: 2, overflow: 'hidden' }}>
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: stageBarColor(stage.verdict),
              transition: 'width 0.2s',
            }}
          />
        </div>
        {stage.missing_skills.length > 0 && (
          <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
            missing: {stage.missing_skills.map((s) => s.label || s.id).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top of mind — "what's settled" surface. The mirror to Gaps: gaps surface
// absences, this surfaces anchors. Shows the highest-confidence active brief
// + the load-bearing decisions the agent is reasoning from. Hidden when
// neither qualifies (new projects, mostly).
// ---------------------------------------------------------------------------

function TopOfMindSection({
  top,
  projectId,
}: {
  top: { brief: BriefSummary | null; decisions: FactRow[] };
  projectId: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {top.brief && <TopBriefCard brief={top.brief} projectId={projectId} />}
      {top.decisions.length > 0 && <TopDecisionsCard decisions={top.decisions} />}
    </div>
  );
}

function TopBriefCard({ brief, projectId }: { brief: BriefSummary; projectId: string }) {
  return (
    <Link
      href={`/project/${projectId}/signals`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '14px 16px',
        background: 'color-mix(in srgb, var(--accent) 5%, var(--surface))',
        border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--line))',
        borderRadius: 6,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          className="lp-mono"
          style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5 }}
        >
          Top brief
        </span>
        {brief.entity_name && <Pill kind="warn">{brief.entity_name}</Pill>}
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
          confidence {(brief.confidence * 100).toFixed(0)}%
        </span>
        <span style={{ flex: 1 }} />
        <Icon d={I.chevr} size={10} style={{ color: 'var(--ink-5)' }} />
      </div>
      <div className="lp-serif" style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>
        {brief.title}
      </div>
      {brief.narrative && (
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: 'var(--ink-3)',
            lineHeight: 1.55,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {brief.narrative}
        </p>
      )}
    </Link>
  );
}

function TopDecisionsCard({ decisions }: { decisions: FactRow[] }) {
  const [now] = useState(() => Date.now());
  // The label dynamically reflects what we surfaced: "Anchors" works for
  // either decisions or fall-through observations without lying about kind.
  const allDecisions = decisions.every((d) => d.kind === 'decision');
  return (
    <div className="lp-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        style={{
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--paper-2)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {allDecisions ? 'Locked decisions' : 'Strongest observations'}
        </span>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
          {decisions.length}
        </span>
      </div>
      <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {decisions.map((d, i) => (
          <div
            key={d.id}
            style={{
              paddingTop: 10,
              borderTop: i === 0 ? 'none' : '1px dashed var(--line)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
              {d.fact}
            </div>
            <div style={{ display: 'flex', gap: 6, fontSize: 10, color: 'var(--ink-5)' }}>
              {d.source_type && <Pill kind="n">{d.source_type}</Pill>}
              <span className="lp-mono">{timeAgo(d.updated_at || d.created_at, now)}</span>
              {d.confidence < 1 && (
                <span className="lp-mono">confidence {(d.confidence * 100).toFixed(0)}%</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gaps — "what's missing" surface. One amber card per gap, kickoff text
// visible inline so the founder can copy it before opening Co-pilot.
// ---------------------------------------------------------------------------

function GapsSection({ gaps, projectId }: { gaps: GapRow[]; projectId: string }) {
  // Cap at 5 in the UI — matches the prompt-cap so the founder sees the same
  // top set the agent is reasoning about, no more.
  const visible = gaps.slice(0, 5);
  const overflow = gaps.length - visible.length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {visible.map((g) => (
        <GapRowCard key={g.id} gap={g} projectId={projectId} />
      ))}
      {overflow > 0 && (
        <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', paddingLeft: 4 }}>
          + {overflow} more {overflow === 1 ? 'gap' : 'gaps'} (run the top ones first)
        </div>
      )}
    </div>
  );
}

function GapRowCard({ gap, projectId }: { gap: GapRow; projectId: string }) {
  // Amber-ish framing so the row reads as "attention needed" without alarming
  // the founder. severity 0-1 gets a stronger tint; 2+ stays subtle.
  const isUrgent = gap.severity <= 1;
  return (
    <div
      className="lp-card"
      style={{
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: isUrgent
          ? 'color-mix(in srgb, var(--clay) 6%, var(--surface))'
          : 'var(--surface)',
        borderColor: isUrgent
          ? 'color-mix(in srgb, var(--clay) 25%, var(--line))'
          : 'var(--line)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Pill kind={isUrgent ? 'warn' : 'n'}>{gap.label}</Pill>
        {gap.stage_number != null && (
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
            stage {gap.stage_number}
          </span>
        )}
        {gap.fill_skill && (
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
            · {gap.fill_skill}
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
        {gap.why}
      </p>
      <div
        className="lp-mono"
        style={{
          fontSize: 11.5,
          color: 'var(--ink-3)',
          padding: '8px 10px',
          background: 'var(--paper-2)',
          borderRadius: 4,
          border: '1px solid var(--line)',
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
        // Selectable on purpose — founders can copy the kickoff into the chat.
      >
        “{gap.fill_kickoff}”
      </div>
      <Link
        href={`/project/${projectId}/chat`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 11,
          padding: '4px 10px',
          border: '1px solid var(--line)',
          borderRadius: 4,
          background: 'var(--surface)',
          color: 'var(--ink-3)',
          textDecoration: 'none',
          fontWeight: 500,
          alignSelf: 'flex-start',
        }}
      >
        <Icon d={I.chat} size={10} stroke={1.4} />
        Open Co-pilot
      </Link>
    </div>
  );
}

function stageBarColor(verdict: ProjectReadiness['overall_verdict']): string {
  switch (verdict) {
    case 'STRONG GO': return 'var(--moss)';
    case 'GO': return 'var(--accent)';
    case 'CAUTION': return 'var(--clay)';
    case 'NOT READY': return 'var(--ink-5)';
  }
}

// ---------------------------------------------------------------------------
// Idea section — 2-col grid of canvas fields, or empty CTA
// ---------------------------------------------------------------------------

function IdeaSection({ idea, projectId }: { idea: IdeaRow | null; projectId: string }) {
  if (!idea) return <EmptyState text="Run the Idea Shaping skill in Co-pilot to build your Lean Canvas." projectId={projectId} />;
  const allEmpty = IDEA_FIELDS.every(({ key }) => !idea[key]);
  if (allEmpty) return <EmptyState text="Your Idea Canvas is empty. Start a chat to populate it." projectId={projectId} />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
      {IDEA_FIELDS.map(({ key, label }) => (
        <div key={key} className="lp-card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            className="lp-mono"
            style={{ fontSize: 10, color: 'var(--ink-5)', letterSpacing: 0.4, textTransform: 'uppercase' }}
          >
            {label}
          </div>
          <div style={{ fontSize: 13, color: idea[key] ? 'var(--ink)' : 'var(--ink-5)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {String(idea[key] ?? '— not yet defined')}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Market section
// ---------------------------------------------------------------------------

function MarketSection({ research, projectId }: { research: ResearchPayload | null; projectId: string }) {
  if (!research) {
    return <EmptyState text="Run Market Research in Co-pilot to populate market size, trends, and insights." projectId={projectId} />;
  }
  const trends = Array.isArray(research.trends)
    ? (research.trends as Array<{ title?: string; name?: string }>).map((t) => t.title || t.name || '').filter(Boolean)
    : [];
  const insights = Array.isArray(research.key_insights)
    ? (research.key_insights as Array<string | { text?: string; insight?: string }>)
        .map((i) => (typeof i === 'string' ? i : i.text || i.insight || ''))
        .filter(Boolean)
    : [];
  const marketSize = research.market_size;

  const isEmpty = trends.length === 0 && insights.length === 0 && !marketSize;
  if (isEmpty) return <EmptyState text="Market research hasn't surfaced anything yet." projectId={projectId} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {marketSize ? (
        <div className="lp-card" style={{ padding: '12px 14px' }}>
          <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>
            Market size
          </div>
          <pre style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-2)', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
            {typeof marketSize === 'string' ? marketSize : JSON.stringify(marketSize, null, 2)}
          </pre>
        </div>
      ) : null}
      {trends.length > 0 && (
        <div className="lp-card" style={{ padding: '12px 14px' }}>
          <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>
            Trends
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {trends.map((t, i) => <Pill key={i} kind="n">{t}</Pill>)}
          </div>
        </div>
      )}
      {insights.length > 0 && (
        <div className="lp-card" style={{ padding: '12px 14px' }}>
          <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>
            Key insights
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {insights.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------

function CompetitorsSection({ competitors, projectId }: { competitors: CompetitorEntry[]; projectId: string }) {
  if (competitors.length === 0) {
    return <EmptyState text="No competitors mapped yet. Market Research or chat conversations about competitors will populate this." projectId={projectId} />;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
      {competitors.map((c) => (
        <div key={`${c.source}-${c.name}`} className="lp-card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
            <span className="lp-serif" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{c.name}</span>
            <span className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-5)' }}>
              from {c.source === 'research' ? 'market research' : 'chat'}
            </span>
          </div>
          {c.summary && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>{c.summary}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Facts — grouped by kind, default-collapsed accordion per group
// ---------------------------------------------------------------------------

function FactsSection({ facts, projectId }: { facts: FactRow[]; projectId: string }) {
  if (facts.length === 0) {
    return <EmptyState text="Confirmed insights from chat and signals will accumulate here." projectId={projectId} />;
  }
  const grouped = new Map<string, FactRow[]>();
  for (const f of facts) {
    const k = FACT_KIND_LABEL[f.kind] ? f.kind : 'fact';
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(f);
  }
  // Within each group sort by confidence DESC, then updated_at DESC so
  // high-confidence items float to the top of their group and stale
  // low-confidence ones sink. Pure UI sort — does not mutate the source.
  for (const items of grouped.values()) {
    items.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }
  const orderedKinds = FACT_KIND_ORDER.filter((k) => grouped.has(k));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {orderedKinds.map((kind) => (
        <FactGroup key={kind} label={FACT_KIND_LABEL[kind] ?? kind} items={grouped.get(kind)!} />
      ))}
    </div>
  );
}

function FactGroup({ label, items }: { label: string; items: FactRow[] }) {
  // First group expanded by default to surface the most important content;
  // subsequent groups stay collapsed for scannability.
  const [expanded, setExpanded] = useState(true);
  const [now] = useState(() => Date.now());
  function toggle() { setExpanded((v) => !v); }
  return (
    <div className="lp-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', cursor: 'pointer' }}
      >
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{label}</span>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>{items.length}</span>
        <Chevron open={expanded} />
      </div>
      {expanded && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((f) => (
            <FactItem key={f.id} fact={f} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Per-fact row: the fact text + metadata chips + an expandable source chain
 * audit row when the fact has sources[] (issue #22). Sources hidden by
 * default — the founder opts in via the "sources" affordance so the layout
 * doesn't bloat for routine facts.
 */
function FactItem({ fact, now }: { fact: FactRow; now: number }) {
  const [chainOpen, setChainOpen] = useState(false);
  const sources = Array.isArray(fact.sources) ? fact.sources : [];
  const hasChain = sources.length > 0;
  return (
    <div style={{ paddingTop: 10, borderTop: '1px dashed var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{fact.fact}</div>
      <div style={{ display: 'flex', gap: 6, fontSize: 10, color: 'var(--ink-5)', alignItems: 'center', flexWrap: 'wrap' }}>
        {fact.source_type && <Pill kind="n">{fact.source_type}</Pill>}
        <span className="lp-mono">{timeAgo(fact.updated_at || fact.created_at, now)}</span>
        {fact.confidence < 1 && <span className="lp-mono">confidence {(fact.confidence * 100).toFixed(0)}%</span>}
        {hasChain && (
          <button
            type="button"
            onClick={() => setChainOpen((v) => !v)}
            aria-expanded={chainOpen}
            style={{
              border: 'none',
              background: 'none',
              padding: '2px 6px',
              color: chainOpen ? 'var(--accent)' : 'var(--ink-4)',
              cursor: 'pointer',
              fontSize: 10,
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {chainOpen ? 'hide' : 'show'} source chain ({sources.length})
            <Chevron open={chainOpen} />
          </button>
        )}
      </div>
      {hasChain && chainOpen && <SourceChain sources={sources} />}
    </div>
  );
}

/**
 * Render the source chain for one fact. Each source type gets a distinct
 * row variant so the audit story reads: "from web URL X", "from skill Y",
 * "from internal ref of type graph_node", etc. Inference sources recurse
 * (shallow — based_on is rendered as a comma-separated list, not infinite).
 *
 * Issue #22.
 */
function SourceChain({ sources }: { sources: FactSource[] }) {
  return (
    <div
      style={{
        marginTop: 6,
        paddingTop: 8,
        borderTop: '1px dotted var(--line)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {sources.map((s, i) => (
        <SourceRow key={i} source={s} index={i} />
      ))}
    </div>
  );
}

function SourceRow({ source, index }: { source: FactSource; index: number }) {
  const numberCol = (
    <span
      className="lp-mono"
      style={{
        fontSize: 10,
        color: 'var(--ink-5)',
        width: 16,
        flexShrink: 0,
        textAlign: 'right',
      }}
    >
      [{index + 1}]
    </span>
  );
  switch (source.type) {
    case 'web':
      return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, color: 'var(--ink-3)' }}>
          {numberCol}
          <Pill kind="info">web</Pill>
          <div style={{ flex: 1, minWidth: 0 }}>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              style={{ color: 'var(--accent)', textDecoration: 'none', wordBreak: 'break-word' }}
            >
              {source.title || source.url}
            </a>
            {source.accessed_at && (
              <span className="lp-mono" style={{ marginLeft: 6, color: 'var(--ink-5)', fontSize: 10 }}>
                · accessed {source.accessed_at.slice(0, 10)}
              </span>
            )}
            {source.quote && (
              <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2, fontStyle: 'italic' }}>
                “{source.quote.slice(0, 200)}{source.quote.length > 200 ? '…' : ''}”
              </div>
            )}
          </div>
        </div>
      );
    case 'skill':
      return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, color: 'var(--ink-3)' }}>
          {numberCol}
          <Pill kind="ok">skill</Pill>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: 'var(--ink-2)' }}>{source.title}</span>
            <span className="lp-mono" style={{ marginLeft: 6, color: 'var(--ink-5)', fontSize: 10 }}>
              · {source.skill_id}
              {source.run_id ? ` · run ${source.run_id.slice(0, 8)}` : ''}
            </span>
            {source.quote && (
              <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2, fontStyle: 'italic' }}>
                “{source.quote.slice(0, 200)}{source.quote.length > 200 ? '…' : ''}”
              </div>
            )}
          </div>
        </div>
      );
    case 'internal':
      return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, color: 'var(--ink-3)' }}>
          {numberCol}
          <Pill kind="n">internal</Pill>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: 'var(--ink-2)' }}>{source.title}</span>
            <span className="lp-mono" style={{ marginLeft: 6, color: 'var(--ink-5)', fontSize: 10 }}>
              · {source.ref} · {source.ref_id.slice(0, 12)}
            </span>
            {source.quote && (
              <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2, fontStyle: 'italic' }}>
                “{source.quote.slice(0, 200)}{source.quote.length > 200 ? '…' : ''}”
              </div>
            )}
          </div>
        </div>
      );
    case 'user':
      return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, color: 'var(--ink-3)' }}>
          {numberCol}
          <Pill kind="warn">user</Pill>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: 'var(--ink-2)' }}>{source.title}</span>
            {source.chat_turn_id && (
              <span className="lp-mono" style={{ marginLeft: 6, color: 'var(--ink-5)', fontSize: 10 }}>
                · chat turn {source.chat_turn_id.slice(0, 8)}
              </span>
            )}
            <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2, fontStyle: 'italic' }}>
              “{source.quote.slice(0, 200)}{source.quote.length > 200 ? '…' : ''}”
            </div>
          </div>
        </div>
      );
    case 'inference': {
      const basis = source.based_on.map((b) => b.title).join(', ');
      return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, color: 'var(--ink-3)' }}>
          {numberCol}
          <Pill kind="n">inference</Pill>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: 'var(--ink-2)' }}>{source.title}</span>
            <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2 }}>
              Based on: {basis || '(no sub-sources cited)'}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2, fontStyle: 'italic' }}>
              {source.reasoning.slice(0, 240)}{source.reasoning.length > 240 ? '…' : ''}
            </div>
          </div>
        </div>
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Entities — chip groups by node_type
// ---------------------------------------------------------------------------

function EntitiesSection({ entities }: { entities: GraphNodeRow[] }) {
  const grouped = new Map<string, GraphNodeRow[]>();
  for (const e of entities) {
    if (!grouped.has(e.node_type)) grouped.set(e.node_type, []);
    grouped.get(e.node_type)!.push(e);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from(grouped.entries()).map(([type, list]) => (
        <div key={type} className="lp-card" style={{ padding: '12px 14px' }}>
          <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>
            {NODE_TYPE_LABEL[type] ?? type.replace(/_/g, ' ')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {list.map((n) => (
              <span key={n.id} title={n.summary ?? undefined}>
                <Pill kind="n">{n.name}</Pill>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Briefs — compact list, link to Signals
// ---------------------------------------------------------------------------

function BriefsSection({ briefs, projectId }: { briefs: BriefSummary[]; projectId: string }) {
  return (
    <div className="lp-card" style={{ padding: 0, overflow: 'hidden' }}>
      {briefs.map((b, i) => (
        <Link
          key={b.id}
          href={`/project/${projectId}/signals`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderTop: i === 0 ? 'none' : '1px solid var(--line)',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          {b.entity_name && <Pill kind="warn">{b.entity_name}</Pill>}
          <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {b.title}
          </span>
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', flexShrink: 0 }}>
            {(b.confidence * 100).toFixed(0)}%
          </span>
          <Icon d={I.chevr} size={10} style={{ color: 'var(--ink-5)', flexShrink: 0 }} />
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill completions
// ---------------------------------------------------------------------------

function SkillsSection({ skills }: { skills: SkillCompletionRow[] }) {
  const [now] = useState(() => Date.now());
  return (
    <div className="lp-card" style={{ padding: 0, overflow: 'hidden' }}>
      {skills.map((s, i) => (
        <div
          key={`${s.skill_id}-${s.completed_at}-${i}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderTop: i === 0 ? 'none' : '1px solid var(--line)',
          }}
        >
          <Pill kind={s.status === 'completed' ? 'ok' : 'n'}>{s.skill_id}</Pill>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.summary ?? '—'}
          </span>
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', flexShrink: 0 }}>
            {timeAgo(s.completed_at, now)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function EmptyState({ text, projectId }: { text: string; projectId: string }) {
  return (
    <div
      className="lp-card"
      style={{
        padding: '20px 24px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        alignItems: 'center',
        background: 'var(--surface)',
        borderStyle: 'dashed',
      }}
    >
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-4)', maxWidth: 420, lineHeight: 1.5 }}>{text}</p>
      <Link
        href={`/project/${projectId}/chat`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 11,
          padding: '4px 10px',
          border: '1px solid var(--line)',
          borderRadius: 4,
          background: 'var(--surface)',
          color: 'var(--ink-3)',
          textDecoration: 'none',
          fontWeight: 500,
        }}
      >
        <Icon d={I.chat} size={10} stroke={1.4} />
        Open Co-pilot
      </Link>
    </div>
  );
}

function CenterMessage({ text, kind }: { text: string; kind?: 'error' }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        fontSize: 12.5,
        color: kind === 'error' ? 'var(--clay)' : 'var(--ink-5)',
      }}
    >
      {text}
    </div>
  );
}

function timeAgo(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{ transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none', flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
