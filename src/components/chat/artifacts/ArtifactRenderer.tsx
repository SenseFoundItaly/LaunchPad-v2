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
import SourcesFooter from './SourcesFooter';
import { RadarChart, BarChart, PieChart, GaugeChart, ScoreCard } from '@/components/charts';

interface ArtifactRendererProps {
  artifact: Artifact;
  onAction: (action: string, payload: Record<string, unknown>) => void;
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
      return <ComparisonTable artifact={artifact} />;
    case 'action-suggestion':
      return <ActionSuggestionCard artifact={artifact} onAction={onAction} />;
    case 'score-badge':
      return <ScoreBadge artifact={artifact} />;
    case 'entity-card':
      return <EntityCardInline artifact={artifact} onEntityDiscovered={onEntityDiscovered} />;
    case 'workflow-card':
      return (
        <WorkflowCardInline
          artifact={artifact}
          onWorkflowDiscovered={onWorkflowDiscovered || (() => {})}
          onAction={onAction}
        />
      );
    // Charts don't own their own wrapper div, so we wrap each in a small
    // container + SourcesFooter. Keeping the chart component untouched
    // means the chart stays usable elsewhere without a forced sources prop.
    case 'radar-chart':
      return (
        <div>
          <RadarChart data={artifact.data} title={artifact.title} />
          <SourcesFooter sources={artifact.sources} />
        </div>
      );
    case 'bar-chart':
      return (
        <div>
          <BarChart data={artifact.data} title={artifact.title} />
          <SourcesFooter sources={artifact.sources} />
        </div>
      );
    case 'pie-chart':
      return (
        <div>
          <PieChart data={artifact.data} title={artifact.title} />
          <SourcesFooter sources={artifact.sources} />
        </div>
      );
    case 'gauge-chart':
      return (
        <div>
          <GaugeChart score={artifact.score} maxScore={artifact.maxScore} label={artifact.title} verdict={artifact.verdict} />
          <SourcesFooter sources={artifact.sources} />
        </div>
      );
    case 'score-card':
      return (
        <div>
          <ScoreCard title={artifact.title} score={artifact.score} maxScore={artifact.maxScore} description={artifact.description} />
          <SourcesFooter sources={artifact.sources} />
        </div>
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
