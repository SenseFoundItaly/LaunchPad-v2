'use client';

import type { Artifact, EntityCard, Source, WorkflowCard } from '@/types/artifacts';
import { Pill } from '@/components/design/primitives';
import OptionSetCard from './OptionSetCard';
import InsightCard from './InsightCard';
import ComparisonTable from './ComparisonTable';
import ActionSuggestionCard from './ActionSuggestionCard';
import ScoreBadge from './ScoreBadge';
import EntityCardInline from './EntityCardInline';
import WorkflowCardInline from './WorkflowCardInline';
import MetricGridCard from './MetricGridCard';
import SensitivitySliderCard from './SensitivitySliderCard';
import MonitorProposalCard from './MonitorProposalCard';
import BudgetProposalCard from './BudgetProposalCard';
import HtmlPreviewCard from './HtmlPreviewCard';
import DocumentCard from './DocumentCard';
import SolveProgressCard from './SolveProgressCard';
import PersonaCard from './PersonaCard';
import RiskMatrixCard from './RiskMatrixCard';
import IdeaCanvasCard from './IdeaCanvasCard';
import TamSamSomCard from './TamSamSomCard';
import InvestorPipelineCard from './InvestorPipelineCard';
import WeeklyUpdateCard from './WeeklyUpdateCard';
import ArtifactCardShell from './ArtifactCardShell';
import { RadarChart, BarChart, PieChart, GaugeChart, ScoreCard } from '@/components/charts';

interface ArtifactRendererProps {
  artifact: Artifact;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
  onEntityDiscovered: (entity: EntityCard) => void;
  onWorkflowDiscovered?: (workflow: WorkflowCard) => void;
}

/**
 * Metric provenance pill — founder-asserted numbers must not render with the
 * same visual authority as measured facts. Returns a muted "self-reported"
 * pill UNLESS at least one `web` or `skill` source backs the artifact;
 * user/inference/internal-only (or missing/malformed) sources mean the
 * numbers are unverified self-reports by definition.
 *
 * Defensive on purpose: artifacts come from a parser over model output, so
 * `sources` can be absent or contain junk entries — never crash, just show
 * the pill.
 */
function metricProvenancePill(sources?: Source[]): React.ReactNode {
  const list = Array.isArray(sources) ? sources : [];
  const verified = list.some((s) => {
    const t = s && typeof s === 'object' ? (s as { type?: unknown }).type : undefined;
    return t === 'web' || t === 'skill';
  });
  if (verified) return null;
  return (
    <span
      title="Founder-asserted numbers — not yet verified by a web source or workflow/skill run."
      style={{ opacity: 0.85, flexShrink: 0 }}
    >
      <Pill kind="n">self-reported</Pill>
    </span>
  );
}

export default function ArtifactRenderer({
  artifact,
  onAction,
  onEntityDiscovered,
  onWorkflowDiscovered,
}: ArtifactRendererProps) {
  switch (artifact.type) {
    case 'option-set':
      return <OptionSetCard artifact={artifact} onAction={onAction} />;
    case 'insight-card':
      return <InsightCard artifact={artifact} onAction={onAction} />;
    case 'comparison-table':
      return <ComparisonTable artifact={artifact} onAction={onAction} />;
    case 'action-suggestion':
      return <ActionSuggestionCard artifact={artifact} onAction={onAction} />;
    case 'score-badge':
      return <ScoreBadge artifact={artifact} />;
    case 'entity-card':
      return <EntityCardInline artifact={artifact} onEntityDiscovered={onEntityDiscovered} onAction={onAction} />;
    case 'workflow-card':
      return (
        <WorkflowCardInline
          artifact={artifact}
          onWorkflowDiscovered={onWorkflowDiscovered || (() => {})}
          onAction={onAction}
        />
      );
    case 'radar-chart':
      return (
        <ArtifactCardShell typeLabel="Chart" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance}>
          <RadarChart data={artifact.data} />
        </ArtifactCardShell>
      );
    case 'bar-chart':
      return (
        <ArtifactCardShell typeLabel="Chart" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance}>
          <BarChart data={artifact.data} />
        </ArtifactCardShell>
      );
    case 'pie-chart':
      return (
        <ArtifactCardShell typeLabel="Chart" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance}>
          <PieChart data={artifact.data} />
        </ArtifactCardShell>
      );
    case 'gauge-chart':
      return (
        <ArtifactCardShell typeLabel="Chart" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance} headerRight={metricProvenancePill(artifact.sources)}>
          <GaugeChart score={artifact.score} maxScore={artifact.maxScore} verdict={artifact.verdict} />
        </ArtifactCardShell>
      );
    case 'score-card':
      return (
        <ArtifactCardShell typeLabel="Score" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance} headerRight={metricProvenancePill(artifact.sources)}>
          <ScoreCard title="" score={artifact.score} maxScore={artifact.maxScore} description={artifact.description} />
        </ArtifactCardShell>
      );
    case 'metric-grid': {
      // MetricGridCard owns its ArtifactCardShell header, so the provenance
      // pill attaches here at the renderer level, flush with the card's
      // top-right corner (the -8px margin cancels the card's my-2 top gap).
      // One pill per grid — per-cell badges would be clutter.
      const pill = metricProvenancePill(artifact.sources);
      if (!pill) return <MetricGridCard artifact={artifact} onAction={onAction} />;
      return (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -8 }}>
            {pill}
          </div>
          <MetricGridCard artifact={artifact} onAction={onAction} />
        </div>
      );
    }
    case 'sensitivity-slider':
      return <SensitivitySliderCard artifact={artifact} onAction={onAction} />;
    case 'monitor-proposal':
      return <MonitorProposalCard artifact={artifact} onAction={onAction} />;
    case 'budget-proposal':
      return <BudgetProposalCard artifact={artifact} onAction={onAction} />;
    case 'html-preview':
      return <HtmlPreviewCard artifact={artifact} />;
    case 'document':
      return <DocumentCard artifact={artifact} />;
    case 'solve-progress':
      return <SolveProgressCard artifact={artifact} />;
    case 'persona-card':
      return <PersonaCard artifact={artifact} />;
    case 'risk-matrix':
      return <RiskMatrixCard artifact={artifact} />;
    case 'idea-canvas':
      return <IdeaCanvasCard artifact={artifact} />;
    case 'tam-sam-som':
      return <TamSamSomCard artifact={artifact} />;
    case 'investor-pipeline':
      return <InvestorPipelineCard artifact={artifact} />;
    case 'weekly-update':
      return <WeeklyUpdateCard artifact={artifact} />;
    case 'task':  // Inline-only — rendered by InlineArtifact → TaskCard in chat/page.tsx
    case 'fact':  // Server-only — intercepted by chat route, never sent to client
      return null;
    default:
      return null;
  }
}
