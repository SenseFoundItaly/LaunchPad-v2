'use client';

import { useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Insight cards — a carousel of one-line findings, each backed by an embedded
 * mini-visualisation.
 *
 * Ported from the Beautiful UI "Insight Cards" primitive, restyled onto the
 * SenseFound tokens. Deliberate changes from the source:
 *
 *  1. The three pages (flavour comparison, freezer anomaly, vanilla allocation)
 *     were module constants built from invented numbers, with timestamps
 *     manufactured from `Date.now()` at import time. All of that is gone: the
 *     caller passes `insights`, and each card takes its series/segments as
 *     props. Nothing on screen is synthesised by this file.
 *  2. The source rendered its charts with `liveline`, which this repo does not
 *     depend on. The charts are hand-rolled inline SVG here — same frame, same
 *     scrub-to-inspect interaction, no new dependency. `useDarkMode` went with
 *     it: the SVG paints from CSS variables, so it themes for free.
 *  3. The header/crossfade wrapper carried a static `opacity:1; filter:blur(0)`
 *     — a transition that could never fire. It's the house `lp-fade-in`, keyed
 *     on the page, so a page change actually reads as one.
 *
 * Hover/scrub, metric toggles, segment selection and the pager are all real
 * local interaction and are kept.
 */

/** One sample. `label` is what the tooltip calls this x position. */
export interface ChartPoint {
  value: number;
  label?: string;
}

export interface ChartSeries {
  id: string;
  /** Tooltip/legend name. Caller's copy. */
  name: string;
  /** Any CSS colour — prefer a token, e.g. `var(--cat-gold)`. */
  color: string;
  points: ChartPoint[];
}

/** Direction of a number, which drives moss (up) vs clay (down). */
export type InsightTone = 'positive' | 'negative';

const TONE_TEXT: Record<InsightTone, string> = {
  positive: 'text-moss',
  negative: 'text-clay',
};

/* ── chart primitives ─────────────────────────────────────────────────────── */

// Vertical breathing room inside the 0–100 viewBox, mirroring the source's
// 24px top / 22px bottom padding on a 166px stage.
const TOP_PAD = 14;
const BOTTOM_PAD = 13;

function extent(series: ChartSeries[]): [number, number] {
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? [min - 1, max + 1] : [min, max];
}

function xAt(index: number, count: number): number {
  return count <= 1 ? 50 : (index / (count - 1)) * 100;
}

function yAt(value: number, min: number, max: number): number {
  const span = max - min || 1;
  return TOP_PAD + (1 - (value - min) / span) * (100 - TOP_PAD - BOTTOM_PAD);
}

function pathFor(points: ChartPoint[], min: number, max: number): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i, points.length).toFixed(2)},${yAt(p.value, min, max).toFixed(2)}`)
    .join(' ');
}

function indexFromPointer(event: React.PointerEvent<HTMLDivElement>, count: number): number {
  const rect = event.currentTarget.getBoundingClientRect();
  const progress = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  return Math.round(progress * (count - 1));
}

/**
 * The chart stage: SVG lines plus a pointer-driven cursor and tooltip.
 *
 * The hovered index is lifted to the caller because the frame header reflects
 * it (the anomaly card swaps its caption for the hovered value).
 */
function ChartStage({
  series,
  grid,
  hoverIndex,
  onHover,
  format,
}: {
  series: ChartSeries[];
  grid?: boolean;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  format: (value: number) => string;
}) {
  const count = series[0]?.points.length ?? 0;
  const [min, max] = extent(series);
  const hovered = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < count ? hoverIndex : null;
  const cursorLeft = hovered === null ? 0 : xAt(hovered, count);
  const anchorLeft = Math.min(Math.max(cursorLeft, 28), 72);

  return (
    <div
      className="relative h-[166px] touch-none"
      onPointerDown={(event) => onHover(indexFromPointer(event, count))}
      onPointerMove={(event) => onHover(indexFromPointer(event, count))}
      onPointerLeave={() => onHover(null)}
      onPointerCancel={() => onHover(null)}
      onPointerUp={() => onHover(null)}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {grid &&
          [25, 50, 75].map((y) => (
            <line
              key={y}
              x1="0"
              x2="100"
              y1={y}
              y2={y}
              stroke="var(--line)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        {series.map((s) => (
          <path
            key={s.id}
            d={pathFor(s.points, min, max)}
            fill="none"
            stroke={s.color}
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {/* leading dot — the latest value, the one the headline numbers quote */}
      {series.map((s) => {
        const last = s.points.at(-1);
        if (!last) return null;
        return (
          <span
            key={s.id}
            aria-hidden
            className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: 'calc(100% - 3px)', top: `${yAt(last.value, min, max)}%`, background: s.color }}
          />
        );
      })}

      {hovered !== null && (
        <>
          <span
            aria-hidden
            className="absolute inset-y-0 w-px bg-line-2"
            style={{ left: `${cursorLeft}%` }}
          />
          <span className="absolute top-2 -translate-x-1/2" style={{ left: `${anchorLeft}%` }}>
            <span
              className="lp-fade-in flex min-w-28 flex-col gap-1 rounded-[var(--r-s)] bg-surface px-2 py-1.5"
              style={{ boxShadow: 'var(--shadow-lift)' }}
            >
              {series[0]?.points[hovered]?.label && (
                <span className="text-[10.5px] text-ink-3 tabular-nums">{series[0].points[hovered].label}</span>
              )}
              {series.map((s) => (
                <span key={s.id} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="flex items-center gap-1.5 text-ink-2">
                    <span className="size-1.5 rounded-full" style={{ background: s.color }} />
                    {s.name}
                  </span>
                  <strong className="font-medium text-ink tabular-nums">
                    {format(s.points[hovered]?.value ?? 0)}
                  </strong>
                </span>
              ))}
            </span>
          </span>
        </>
      )}
    </div>
  );
}

function ChartFrame({ left, right, children }: { left: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-2 overflow-hidden rounded-[var(--r-s)] border border-line bg-surface-sunk">
      <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
        <span className="text-[11px] text-ink-3 tabular-nums">{left}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[10.5px] font-medium text-ink-2">{children}</span>
  );
}

const CARD_CLASS = 'min-h-[278px] rounded-[var(--r-l)] border border-line bg-surface p-3';

/* ── prose helpers ────────────────────────────────────────────────────────── */

/** Inline `@entity` mention, for use inside an insight's prose. */
export function InsightEntity({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 align-baseline font-medium text-ink">
      <span className="inline-block size-2.5 rounded-full" style={{ background: color }} />
      {`@${name}`}
    </span>
  );
}

/** Inline monospace figure, tinted by direction. */
export function InsightMono({ children, tone }: { children: React.ReactNode; tone: InsightTone }) {
  return <code className={`font-mono text-[11.5px] ${TONE_TEXT[tone]}`}>{children}</code>;
}

/* ── 1 — comparison: two series, legend + deltas + line chart ─────────────── */

export interface CompareSeries extends ChartSeries {
  /** Headline delta, pre-formatted by the caller, e.g. "-4.41%". */
  delta: string;
  /** Monospace subline under the delta, e.g. "-$2,377.66". */
  sub?: string;
  tone: InsightTone;
}

export interface CompareCardProps {
  series: CompareSeries[];
  /** Chart frame caption, e.g. "Trend snapshot". */
  caption: string;
  /** Optional pill on the right of the frame header. */
  badge?: string;
  /** Formats values in the tooltip. */
  format?: (value: number) => string;
}

export function CompareCard({ series, caption, badge, format = String }: CompareCardProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center gap-4">
        {series.map((s) => (
          <div key={s.id} className="flex-1">
            <span className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
            <span
              className={`block text-[17px] font-semibold tracking-[-0.01em] tabular-nums ${TONE_TEXT[s.tone]}`}
            >
              {s.delta}
            </span>
            {s.sub && <InsightMono tone={s.tone}>{s.sub}</InsightMono>}
          </div>
        ))}
      </div>

      <ChartFrame left={caption} right={badge ? <Badge>{badge}</Badge> : undefined}>
        <ChartStage series={series} hoverIndex={hoverIndex} onHover={setHoverIndex} format={format} />
      </ChartFrame>
    </div>
  );
}

/* ── 2 — anomaly: one series, a metric toggle, a headline total ───────────── */

export interface AnomalyMetric {
  id: string;
  /** Toggle label. Caller's copy. */
  label: string;
  points: ChartPoint[];
  /** Formats this metric's values (tooltip + hovered caption). */
  format: (value: number) => string;
  /** Frame caption when nothing is hovered, e.g. "$2,112 threshold". */
  caption: string;
}

export interface AnomalyCardProps {
  /** Card heading, e.g. "High freezer spend". Caller's copy. */
  title: string;
  metrics: AnomalyMetric[];
  /** Line colour. Defaults to clay — this card exists to flag an outlier. */
  color?: string;
  badge?: string;
  /** Footline under the chart. */
  summary?: {
    value: string;
    delta?: string;
    deltaTone?: InsightTone;
    note?: string;
  };
}

const UpIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--clay)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
);

export function AnomalyCard({ title, metrics, color = 'var(--clay)', badge, summary }: AnomalyCardProps) {
  const [metricId, setMetricId] = useState(metrics[0]?.id);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (metrics.length === 0) return null;
  const metric = metrics.find((m) => m.id === metricId) ?? metrics[0];
  const series: ChartSeries[] = [{ id: metric.id, name: metric.label, color, points: metric.points }];
  const hoveredValue = hoverIndex === null ? null : metric.points[hoverIndex]?.value ?? null;

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
          {UpIcon}
          {title}
        </span>
        {badge && <Badge>{badge}</Badge>}
      </div>

      <ChartFrame
        left={hoveredValue === null ? metric.caption : metric.format(hoveredValue)}
        right={
          metrics.length > 1 ? (
            <span className="flex rounded-full bg-paper-2 p-0.5">
              {metrics.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={m.id === metric.id}
                  onClick={() => {
                    setMetricId(m.id);
                    setHoverIndex(null);
                  }}
                  className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
                    m.id === metric.id ? 'bg-surface text-ink' : 'text-ink-3 hover:text-ink-2'
                  }`}
                  style={m.id === metric.id ? { boxShadow: 'var(--shadow-card)' } : undefined}
                >
                  {m.label}
                </button>
              ))}
            </span>
          ) : undefined
        }
      >
        <ChartStage series={series} grid hoverIndex={hoverIndex} onHover={setHoverIndex} format={metric.format} />
      </ChartFrame>

      {summary && (
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-[17px] font-semibold tracking-[-0.01em] text-ink tabular-nums">{summary.value}</span>
          {summary.delta && <InsightMono tone={summary.deltaTone ?? 'negative'}>{summary.delta}</InsightMono>}
          {summary.note && <span className="text-[11px] text-ink-3">{summary.note}</span>}
        </div>
      )}
    </div>
  );
}

/* ── 3 — allocation: hero number + segmented bar + legend ─────────────────── */

export interface AllocationSegment {
  id: string;
  /** Short code for the legend, e.g. "VAN". */
  code: string;
  /** Full name shown in the detail panel. */
  label: string;
  /** Share of the whole, 0–100. Drives the bar width. */
  pct: number;
  /** Pre-formatted headline amount, e.g. "$51,785". */
  amount: string;
  /** Any CSS colour — prefer a token. */
  color: string;
  /** Detail-panel copy for this segment. Caller's. */
  description?: string;
}

export interface AllocationCardProps {
  /** Card heading. Caller's copy. */
  title: string;
  /** Optional glyph before the title (an initial badge, a dot, an icon). */
  icon?: React.ReactNode;
  segments: AllocationSegment[];
  defaultSegmentId?: string;
}

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

export function AllocationCard({ title, icon, segments, defaultSegmentId }: AllocationCardProps) {
  const t = useT();
  const [selectedId, setSelectedId] = useState(defaultSegmentId ?? segments[0]?.id);

  if (segments.length === 0) return null;
  const active = segments.find((s) => s.id === selectedId) ?? segments[0];

  return (
    <div className={CARD_CLASS}>
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
        {icon}
        {title}
      </span>
      <span className="mt-1 block text-[20px] font-semibold tracking-[-0.01em] text-ink tabular-nums">
        {active.amount}
      </span>

      <div
        className="mt-3 flex h-9 gap-0.5 overflow-hidden rounded-full bg-paper-2 p-0.5"
        role="group"
        aria-label={t('ui.insights.segments')}
      >
        {segments.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === active.id}
            aria-label={`${s.label}: ${s.pct}%`}
            onClick={() => setSelectedId(s.id)}
            className="relative h-full overflow-hidden rounded-full transition-[opacity,transform,box-shadow] duration-300 active:scale-[0.98]"
            style={{
              width: `${s.pct}%`,
              background: s.color,
              opacity: s.id === active.id ? 1 : 0.58,
              boxShadow: s.id === active.id ? 'inset 0 0 0 1px rgba(255,255,255,0.22)' : undefined,
              transitionTimingFunction: EASE,
            }}
          >
            <span
              className="absolute inset-y-1 left-1 rounded-full bg-white/20 transition-[width,opacity] duration-500"
              style={{
                width: s.id === active.id ? 'calc(100% - 8px)' : '0%',
                opacity: s.id === active.id ? 1 : 0,
                transitionTimingFunction: EASE,
              }}
            />
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        {segments.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === active.id}
            onClick={() => setSelectedId(s.id)}
            className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
              s.id === active.id ? 'bg-paper-2 text-ink' : 'text-ink-2 hover:bg-paper-2 hover:text-ink'
            }`}
          >
            <span className="size-1.5 rounded-full" style={{ background: s.color }} />
            {s.code} <span className="tabular-nums">{`${s.pct}%`}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 min-h-16 rounded-[var(--r-s)] border border-line bg-surface-sunk px-2.5 py-2">
        <span className="block text-[11.5px] font-medium" style={{ color: active.color }}>
          {active.label}
        </span>
        {active.description && (
          <span className="mt-1 block text-[11px] leading-relaxed text-ink-3">{active.description}</span>
        )}
      </div>
    </div>
  );
}

/* ── carousel ─────────────────────────────────────────────────────────────── */

export interface Insight {
  id: string;
  /** The finding, one or two lines. Compose with InsightEntity / InsightMono. */
  prose: React.ReactNode;
  /** The visualisation — usually one of the three cards above. */
  card: React.ReactNode;
  /** Optional follow-up prompt shown as a pill under the card. Caller's copy. */
  pill?: string;
  onPill?: () => void;
}

interface Props {
  insights: Insight[];
}

const ARROWS = ['M15 18l-6-6 6-6', 'M9 6l6 6-6 6'] as const;

export function InsightCards({ insights }: Props) {
  const t = useT();
  const [page, setPage] = useState(0);

  if (insights.length === 0) return null;
  const index = page % insights.length;
  const insight = insights[index];

  const move = (direction: -1 | 1) =>
    setPage((current) => (current + direction + insights.length) % insights.length);

  return (
    <div className="min-h-[408px] w-full max-w-86">
      <div className="flex items-center justify-between">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold text-ink">{t('ui.insights.heading')}</span>
          <span className="text-[13px] text-ink-3 tabular-nums">{insights.length}</span>
        </span>
        {insights.length > 1 && (
          <span className="flex items-center gap-0.5">
            {ARROWS.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-label={i === 0 ? t('ui.insights.previous') : t('ui.insights.next')}
                onClick={() => move(i === 0 ? -1 : 1)}
                className="flex size-6 items-center justify-center rounded-[var(--r-m)] text-ink-3 transition-[background-color,color,transform] duration-100 hover:bg-paper-2 hover:text-ink active:scale-[0.96]"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={d} />
                </svg>
              </button>
            ))}
          </span>
        )}
      </div>

      <div key={insight.id} className="lp-fade-in">
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{insight.prose}</p>
        <div className="mt-2">{insight.card}</div>
        {insight.pill && (
          <button
            type="button"
            onClick={insight.onPill}
            className="mt-2 rounded-full bg-surface px-3 py-1.5 text-left text-[12px] text-ink transition-colors duration-100 hover:bg-paper-2"
            style={{ boxShadow: 'var(--shadow-card)' }}
          >
            {insight.pill}
          </button>
        )}
      </div>
    </div>
  );
}
