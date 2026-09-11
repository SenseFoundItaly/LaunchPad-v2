/**
 * Artifact layout policy — chooses how many canvas columns each artifact
 * should claim, factoring both type defaults and content density.
 *
 * The canvas uses a 6-column grid (`gridTemplateColumns: repeat(6, 1fr)`).
 * Until now every artifact except `comparison-table` and `workflow-card`
 * defaulted to `span 2`, producing visible breakage on dense cards like
 * `investor-pipeline` (6 internal kanban columns shoved into ~1/3 canvas
 * width → dates broke char-by-char).
 *
 * Span value semantics:
 *   2 → ~1/3 of canvas, fits one chart or 1-2 KPI tiles.
 *   3 → 1/2 canvas, fits 3-4 tiles or a single persona card.
 *   4 → 2/3 canvas, fits a 4-column kanban or 4-5 column table.
 *   6 → full canvas — required for ≥5-column tables, 9-block canvases, etc.
 *
 * Returned spans are restricted to {2, 3, 4, 6} so two cards-of-equal-density
 * can sit side by side cleanly on every grid row (2+4, 3+3, 6 alone).
 */

import type { Artifact } from '@/types/artifacts';

export type CanvasSpan = 2 | 3 | 4 | 6;

const clamp = (v: number, lo: CanvasSpan, hi: CanvasSpan): CanvasSpan =>
  (Math.min(hi, Math.max(lo, v)) as CanvasSpan);

export function spanForArtifact(a: Artifact): CanvasSpan {
  switch (a.type) {
    // Inherently wide — these cards have so many internal axes they always
    // want full canvas. The pre-fix behavior put them at span 2 and they
    // were unreadable.
    case 'idea-canvas':       // 9-block lean canvas grid
    case 'risk-matrix':       // 5×5 probability/impact grid
    case 'tam-sam-som':       // concentric circles + methodology aside
    case 'document':          // pitch deck / one-pager
    case 'html-preview':      // sandboxed landing page
    case 'workflow-card':     // priority+steps timeline
    case 'weekly-update':     // 4-metric strip + 3 stacked lists
      return 6;

    // Density-adaptive: claim 4 cols for small pipelines, 6 for crowded.
    // 5+ investors makes per-column width fall below the readability floor
    // unless we grant full width.
    case 'investor-pipeline':
      return clamp(a.investors.length >= 5 ? 6 : 4, 4, 6);

    // Tables: column count drives width. ≥5 columns → full canvas.
    case 'comparison-table':
      return a.columns.length >= 5 ? 6 : 4;

    // Metric grids: ≥5 metrics need a 2-row layout that wants more width
    // so labels don't wrap. 3-4 metrics sit comfortably at half-canvas.
    case 'metric-grid':
      return a.metrics.length >= 5 ? 4 : 3;

    // Persona / entity / insight: rich text + a few attributes.
    // Half-canvas is the sweet spot — two can sit side by side.
    case 'persona-card':
    case 'entity-card':
    case 'insight-card':
      return 3;

    // Compact single-value cards — let two-up or three-up rows form.
    case 'score-card':
    case 'gauge-chart':
    case 'score-badge':
    case 'radar-chart':
    case 'bar-chart':
    case 'pie-chart':
      return 2;

    // Interactive / sensitive — keep readable but not full canvas.
    case 'sensitivity-slider':
      return 3;

    // Suggestion-style nudges. Sit narrow.
    case 'action-suggestion':
      return 3;

    // Conservative default for unknown / new artifact types so a new card
    // shipping without a layout entry never looks worse than baseline.
    default:
      return 3;
  }
}
