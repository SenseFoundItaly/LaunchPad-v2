'use client';

import type { Artifact, EntityCard, WorkflowCard } from '@/types/artifacts';
import type { ComponentProps } from 'react';
import type { MessageKey } from '@/lib/i18n/messages';
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
import DocumentCard from './DocumentCard';
import SolveProgressCard from './SolveProgressCard';
import PersonaCard from './PersonaCard';
import RiskMatrixCard from './RiskMatrixCard';
import IdeaCanvasCard from './IdeaCanvasCard';
import TamSamSomCard from './TamSamSomCard';
import InvestorPipelineCard from './InvestorPipelineCard';
import WeeklyUpdateCard from './WeeklyUpdateCard';
import ApprovalRequestCard from './ApprovalRequestCard';
import RecommendationArtifactCard from './RecommendationArtifactCard';
import InsightCarouselCard from './InsightCarouselCard';
import ArtifactCardShell from './ArtifactCardShell';
import dynamic from 'next/dynamic';

// recharts is ~398 KB in a single chunk (measured 2026-09-02). Artifacts render
// on demand inside a chat turn, so the library has no business being in the
// chat route's initial bundle. One boundary per chart, so a canvas showing a
// single chart does not pull the rest of the family.
const RadarChart = dynamic(() => import('@/components/charts').then((m) => m.RadarChart), { ssr: false });
const BarChart = dynamic(() => import('@/components/charts').then((m) => m.BarChart), { ssr: false });
const PieChart = dynamic(() => import('@/components/charts').then((m) => m.PieChart), { ssr: false });
const GaugeChart = dynamic(() => import('@/components/charts').then((m) => m.GaugeChart), { ssr: false });
const ScoreCard = dynamic(() => import('@/components/charts').then((m) => m.ScoreCard), { ssr: false });
import BaselineScoreCard from './BaselineScoreCard';
import { toScore100 } from '@/lib/score-display';
import { isBaselineScoreTitle } from '@/lib/score-display';
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

/**
 * Shell wrapper that resolves the typeLabel i18n key WITH hooks. Kept as a
 * child component so ArtifactRenderer itself stays hook-free — the A3
 * fallback tests invoke ArtifactRenderer as a plain function (no React
 * renderer), which would crash on a top-level useT().
 */
function KeyedShell({
  typeKey,
  ...rest
}: Omit<ComponentProps<typeof ArtifactCardShell>, 'typeLabel'> & { typeKey: MessageKey }) {
  const t = useT();
  return <ArtifactCardShell typeLabel={t(typeKey)} {...rest} />;
}

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
        <KeyedShell typeKey="card.type-chart" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance} exportArtifact={artifact} defaultCollapsed={defaultCollapsed}>
          <RadarChart data={artifact.data} />
        </KeyedShell>
      );
    case 'bar-chart':
      return (
        <KeyedShell typeKey="card.type-chart" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance} exportArtifact={artifact} defaultCollapsed={defaultCollapsed}>
          <BarChart data={artifact.data} />
        </KeyedShell>
      );
    case 'pie-chart':
      return (
        <KeyedShell typeKey="card.type-chart" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance} exportArtifact={artifact} defaultCollapsed={defaultCollapsed}>
          <PieChart data={artifact.data} />
        </KeyedShell>
      );
    case 'gauge-chart':
      return (
        <KeyedShell typeKey="card.type-chart" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance} exportArtifact={artifact} defaultCollapsed={defaultCollapsed}>
          <GaugeChart score={artifact.score} maxScore={artifact.maxScore} verdict={artifact.verdict} />
        </KeyedShell>
      );
    case 'score-card':
      return (
        <KeyedShell typeKey="card.type-score" title={artifact.title} sources={artifact.sources} provenance={artifact.provenance} exportArtifact={artifact} defaultCollapsed={defaultCollapsed}>
          {/* THE project baseline (title-flagged) renders the rich breakdown —
              score/100 + per-dimension bars + verdict — from the authoritative
              /score, matching Home. Per-dimension score-cards stay thin. */}
          {isBaselineScoreTitle(artifact.title)
            ? <BaselineScoreCard artifact={artifact} />
            /* 0-100 canon enforced at the RENDERER: the artifact carries its
               own max, so a model emitting /10 put a bare "6.8" in front of the
               founder next to a /100 Home score. */
            : <ScoreCard
                title=""
                score={toScore100(artifact.score, artifact.maxScore)}
                maxScore={100}
                description={artifact.description}
              />}
        </KeyedShell>
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
    case 'approval-request':
      return <ApprovalRequestCard artifact={artifact} onAction={onAction} defaultCollapsed={defaultCollapsed} />;
    case 'recommendation':
      return <RecommendationArtifactCard artifact={artifact} onAction={onAction} defaultCollapsed={defaultCollapsed} />;
    case 'insight-carousel':
      return <InsightCarouselCard artifact={artifact} defaultCollapsed={defaultCollapsed} />;
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
