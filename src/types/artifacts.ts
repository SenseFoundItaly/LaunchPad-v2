export type ArtifactType =
  | 'option-set'
  | 'insight-card'
  | 'comparison-table'
  | 'action-suggestion'
  | 'score-badge'
  | 'entity-card'
  | 'workflow-card'
  | 'radar-chart'
  | 'bar-chart'
  | 'pie-chart'
  | 'gauge-chart'
  | 'score-card'
  | 'metric-grid'
  | 'sensitivity-slider'
  | 'fact';

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

export interface RadarChartArtifact extends ArtifactBase {
  type: 'radar-chart';
  title: string;
  data: { subject: string; value: number; fullMark?: number }[];
}

export interface BarChartArtifact extends ArtifactBase {
  type: 'bar-chart';
  title: string;
  data: { name: string; value: number }[];
}

export interface PieChartArtifact extends ArtifactBase {
  type: 'pie-chart';
  title: string;
  data: { name: string; value: number }[];
}

export interface GaugeChartArtifact extends ArtifactBase {
  type: 'gauge-chart';
  title: string;
  score: number;
  maxScore?: number;
  verdict?: string;
}

export interface ScoreCardArtifact extends ArtifactBase {
  type: 'score-card';
  title: string;
  score: number;
  maxScore?: number;
  description?: string;
}

export interface SensitivitySlider extends ArtifactBase {
  type: 'sensitivity-slider';
  title: string;
  variables: { name: string; min: number; max: number; value: number; unit?: string }[];
  output: { label: string; formula: string };
}

export interface MetricGrid extends ArtifactBase {
  type: 'metric-grid';
  title: string;
  metrics: { label: string; value: string; change?: string }[];
}

/**
 * `fact` — an agent-extracted durable fact to persist in memory_facts.
 * Not rendered as a visible artifact; the chat route intercepts these and
 * calls recordFact() before sending the message to the client.
 */
export interface FactArtifact extends ArtifactBase {
  type: 'fact';
  fact: string;
  kind?: 'fact' | 'decision' | 'observation' | 'note' | 'preference';
  confidence?: number;
}

export type Artifact =
  | OptionSet
  | InsightCard
  | ComparisonTable
  | ActionSuggestion
  | ScoreBadge
  | EntityCard
  | WorkflowCard
  | RadarChartArtifact
  | BarChartArtifact
  | PieChartArtifact
  | GaugeChartArtifact
  | ScoreCardArtifact
  | MetricGrid
  | SensitivitySlider
  | FactArtifact;
