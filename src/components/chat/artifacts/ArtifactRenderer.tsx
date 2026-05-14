'use client';

import type { Artifact, EntityCard, WorkflowCard } from '@/types/artifacts';
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
import ArtifactCardShell from './ArtifactCardShell';
import { RadarChart, BarChart, PieChart, GaugeChart, ScoreCard } from '@/components/charts';

interface ArtifactRendererProps {
  artifact: Artifact;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
  onEntityDiscovered: (entity: EntityCard) => void;
  onWorkflowDiscovered?: (workflow: WorkflowCard) => void;
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
        <ArtifactCardShell typeLabel="Chart" title={artifact.title} sources={artifact.sources}>
          <RadarChart data={artifact.data} />
        </ArtifactCardShell>
      );
    case 'bar-chart':
      return (
        <ArtifactCardShell typeLabel="Chart" title={artifact.title} sources={artifact.sources}>
          <BarChart data={artifact.data} />
        </ArtifactCardShell>
      );
    case 'pie-chart':
      return (
        <ArtifactCardShell typeLabel="Chart" title={artifact.title} sources={artifact.sources}>
          <PieChart data={artifact.data} />
        </ArtifactCardShell>
      );
    case 'gauge-chart':
      return (
        <ArtifactCardShell typeLabel="Chart" title={artifact.title} sources={artifact.sources}>
          <GaugeChart score={artifact.score} maxScore={artifact.maxScore} verdict={artifact.verdict} />
        </ArtifactCardShell>
      );
    case 'score-card':
      return (
        <ArtifactCardShell typeLabel="Score" title={artifact.title} sources={artifact.sources}>
          <ScoreCard title="" score={artifact.score} maxScore={artifact.maxScore} description={artifact.description} />
        </ArtifactCardShell>
      );
    case 'metric-grid':
      return <MetricGridCard artifact={artifact} onAction={onAction} />;
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
    default:
      return null;
  }
}
