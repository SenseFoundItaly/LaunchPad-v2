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
import ValidationProposalCard from './ValidationProposalCard';
import HtmlPreviewCard from './HtmlPreviewCard';
import { EmailSequenceCard, SocialCalendarCard, AdPackCard } from './CampaignCards';
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
import { useT } from '@/components/providers/LocaleProvider';

interface ArtifactRendererProps {
  artifact: Artifact;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
  onEntityDiscovered: (entity: EntityCard) => void;
  onWorkflowDiscovered?: (workflow: WorkflowCard) => void;
  /**
   * Mount the card collapsed (title row only). The canvas passes true for
   * artifacts from older turns so the latest work renders open and history
   * stays skimmable. Cards that don't wrap ArtifactCardShell ignore it.
   */
  defaultCollapsed?: boolean;
}

// NOTE: the "self-reported" metric-provenance pill was removed in the
// 2026-06 canvas simplification (zero-chips rule). Provenance tiers remain
// founder-visible on the Knowledge page; per-card chips were jargon.

export default function ArtifactRenderer({
  artifact,
  onAction,
  onEntityDiscovered,
  onWorkflowDiscovered,
  defaultCollapsed,
}: ArtifactRendererProps) {
  switch (artifact.type) {
    case 'option-set':
      return <OptionSetCard artifact={artifact} onAction={onAction} />;
    case 'insight-card':
      return <InsightCard artifact={artifact} onAction={onAction} defaultCollapsed={defaultCollapsed} />;
    case 'comparison-table':
      return <ComparisonTable artifact={artifact} onAction={onAction} defaultCollapsed={defaultCollapsed} />;
    case 'action-suggestion':
      return <ActionSuggestionCard artifact={artifact} onAction={onAction} />;
    case 'score-badge':
      return <ScoreBadge artifact={artifact} />;
    case 'entity-card':
      return <EntityCardInline artifact={artifact} onEntityDiscovered={onEntityDiscovered} onAction={onAction} defaultCollapsed={defaultCollapsed} />;
    case 'workflow-card':
      return (
        <WorkflowCardInline
          artifact={artifact}
          onWorkflowDiscovered={onWorkflowDiscovered || (() => {})}
          onAction={onAction}
          defaultCollapsed={defaultCollapsed}
        />
      );
    case 'radar-chart':
      return (
        <ArtifactCardShell typeLabel="Chart" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance} exportArtifact={artifact} defaultCollapsed={defaultCollapsed}>
          <RadarChart data={artifact.data} />
        </ArtifactCardShell>
      );
    case 'bar-chart':
      return (
        <ArtifactCardShell typeLabel="Chart" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance} exportArtifact={artifact} defaultCollapsed={defaultCollapsed}>
          <BarChart data={artifact.data} />
        </ArtifactCardShell>
      );
    case 'pie-chart':
      return (
        <ArtifactCardShell typeLabel="Chart" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance} exportArtifact={artifact} defaultCollapsed={defaultCollapsed}>
          <PieChart data={artifact.data} />
        </ArtifactCardShell>
      );
    case 'gauge-chart':
      return (
        <ArtifactCardShell typeLabel="Chart" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance} exportArtifact={artifact} defaultCollapsed={defaultCollapsed}>
          <GaugeChart score={artifact.score} maxScore={artifact.maxScore} verdict={artifact.verdict} />
        </ArtifactCardShell>
      );
    case 'score-card':
      return (
        <ArtifactCardShell typeLabel="Score" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance} exportArtifact={artifact} defaultCollapsed={defaultCollapsed}>
          <ScoreCard title="" score={artifact.score} maxScore={artifact.maxScore} description={artifact.description} />
        </ArtifactCardShell>
      );
    case 'metric-grid':
      return <MetricGridCard artifact={artifact} onAction={onAction} defaultCollapsed={defaultCollapsed} />;
    case 'sensitivity-slider':
      return <SensitivitySliderCard artifact={artifact} onAction={onAction} />;
    case 'monitor-proposal':
      return <MonitorProposalCard artifact={artifact} onAction={onAction} />;
    case 'budget-proposal':
      return <BudgetProposalCard artifact={artifact} onAction={onAction} />;
    case 'validation-proposal':
      return <ValidationProposalCard artifact={artifact} onAction={onAction} />;
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
    // Launch pipeline deliverables (W2/W3): read surfaces over captured
    // draft campaigns + the export-first ad pack.
    case 'email-sequence':
      return <EmailSequenceCard artifact={artifact} defaultCollapsed={defaultCollapsed} />;
    case 'social-calendar':
      return <SocialCalendarCard artifact={artifact} defaultCollapsed={defaultCollapsed} />;
    case 'ad-pack':
      return <AdPackCard artifact={artifact} defaultCollapsed={defaultCollapsed} />;
    case 'task':  // Inline-only — rendered by InlineArtifact → TaskCard in chat/page.tsx
    case 'fact':  // Server-only — intercepted by chat route, never sent to client
      return null;
    default:
      // A3 (copilot-sota): a parsed-OK artifact of an UNKNOWN type used to drop
      // to null here — silent data loss the founder couldn't see or report. Show
      // a visible "unsupported card" instead. (task/fact above stay null — those
      // nulls are intentional, not failures.)
      return <UnsupportedArtifactCard artifactType={(artifact as { type?: string }).type} />;
  }
}

/** A3: loud-failure fallback for an artifact type the renderer doesn't know. */
function UnsupportedArtifactCard({ artifactType }: { artifactType?: string }) {
  const t = useT();
  return (
    <div
      style={{
        border: '1px solid var(--clay)',
        borderRadius: 'var(--r-m, 10px)',
        background: 'var(--surface)',
        padding: '10px 12px',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 600, color: 'var(--clay)', marginBottom: 2 }}>
        {t('artifact.unsupported-title')}
      </div>
      <div style={{ color: 'var(--ink-4)' }}>
        {t('artifact.unsupported-body', { type: artifactType || '?' })}
      </div>
    </div>
  );
}
