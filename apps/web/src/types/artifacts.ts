export type ArtifactType =
  | 'option-set'
  | 'insight-card'
  | 'comparison-table'
  | 'action-suggestion'
  | 'score-badge'
  | 'entity-card'
  | 'workflow-card'
  | 'tool-trigger';

export interface ArtifactBase {
  type: ArtifactType;
  id: string;
}

export interface OptionSet extends ArtifactBase {
  type: 'option-set';
  prompt: string;
  options: { id: string; label: string; description: string }[];
}

export interface InsightCard extends ArtifactBase {
  type: 'insight-card';
  category: 'competitor' | 'market' | 'risk' | 'opportunity' | 'technology';
  title: string;
  body: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface ComparisonTable extends ArtifactBase {
  type: 'comparison-table';
  title: string;
  columns: string[];
  rows: { label: string; values: string[] }[];
}

export interface ActionSuggestion extends ArtifactBase {
  type: 'action-suggestion';
  title: string;
  description: string;
  action_label: string;
  action_type: 'research' | 'score' | 'simulate' | 'deep-dive' | 'custom';
  action_payload?: Record<string, unknown>;
}

export interface ScoreBadge extends ArtifactBase {
  type: 'score-badge';
  label: string;
  score: number;
  max: number;
}

export interface EntityCard extends ArtifactBase {
  type: 'entity-card';
  name: string;
  entity_type: string;
  summary: string;
  attributes: Record<string, unknown>;
  relationships?: { target: string; relation: string }[];
}

export interface WorkflowCard extends ArtifactBase {
  type: 'workflow-card';
  title: string;
  category: 'hiring' | 'marketing' | 'fundraising' | 'product' | 'legal' | 'operations' | 'sales';
  description: string;
  priority: 'high' | 'medium' | 'low';
  steps: string[];
}

export interface ToolTrigger extends ArtifactBase {
  type: 'tool-trigger';
  tool_name: string;
  params: Record<string, unknown>;
  label: string;
  description: string;
}

export type Artifact =
  | OptionSet
  | InsightCard
  | ComparisonTable
  | ActionSuggestion
  | ScoreBadge
  | EntityCard
  | WorkflowCard
  | ToolTrigger;
