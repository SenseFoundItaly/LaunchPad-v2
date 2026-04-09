'use client';

import type { Artifact, EntityCard, WorkflowCard } from '@/types/artifacts';
import OptionSetCard from './OptionSetCard';
import InsightCard from './InsightCard';
import ComparisonTable from './ComparisonTable';
import ActionSuggestionCard from './ActionSuggestionCard';
import ScoreBadge from './ScoreBadge';
import EntityCardInline from './EntityCardInline';
import WorkflowCardInline from './WorkflowCardInline';
import ToolTriggerCard from './ToolTriggerCard';

interface ArtifactRendererProps {
  artifact: Artifact;
  onAction: (action: string, payload: Record<string, unknown>) => void;
  onEntityDiscovered: (entity: EntityCard) => void;
  onWorkflowDiscovered?: (workflow: WorkflowCard) => void;
  projectId?: string;
}

export default function ArtifactRenderer({
  artifact,
  onAction,
  onEntityDiscovered,
  onWorkflowDiscovered,
  projectId,
}: ArtifactRendererProps) {
  switch (artifact.type) {
    case 'option-set':
      return <OptionSetCard artifact={artifact} onAction={onAction} />;
    case 'insight-card':
      return <InsightCard artifact={artifact} />;
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
    case 'tool-trigger':
      return <ToolTriggerCard artifact={artifact} onAction={onAction} projectId={projectId} />;
    default:
      return null;
  }
}
