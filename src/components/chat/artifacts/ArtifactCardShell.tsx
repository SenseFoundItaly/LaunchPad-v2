'use client';

import { useState } from 'react';
import type { Source } from '@/types/artifacts';
import SourcesFooter from './SourcesFooter';

interface ArtifactCardShellProps {
  /** Uppercase type label shown in the header (e.g. "Insight", "Entity") */
  typeLabel: string;
  /** Title shown next to the type label. Empty string hides the title span. */
  title: string;
  /** Card body — unique per card type */
  children: React.ReactNode;
  /** Sources rendered via SourcesFooter at the bottom */
  sources?: Source[];
  /** Dim the card to opacity-40 (e.g. rejected state) */
  dimmed?: boolean;
  /** Show collapse/expand toggle. Default: true */
  collapsible?: boolean;
  /** Start collapsed. Default: false */
  defaultCollapsed?: boolean;
  /** Right side of the header row (ReviewControls, badges, etc.) */
  headerRight?: React.ReactNode;
  /** Footer slot above sources (e.g. review controls for ComparisonTable) */
  footer?: React.ReactNode;
  /** Extra classes on the body wrapper (e.g. "overflow-x-auto") */
  className?: string;
  /** Extra classes on the outer container (e.g. "col-span-6") */
  outerClassName?: string;
  /** Inline styles on the outer container (e.g. gridColumn: 'span 6') */
  style?: React.CSSProperties;
}

export default function ArtifactCardShell({
  typeLabel,
  title,
  children,
  sources,
  dimmed = false,
  collapsible = true,
  defaultCollapsed = false,
  headerRight,
  footer,
  className,
  outerClassName,
  style,
}: ArtifactCardShellProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div
      className={`my-3 bg-paper-2/50 border border-line-2 rounded-lg transition-opacity ${
        dimmed ? 'opacity-40' : ''
      } ${collapsed ? 'p-2.5' : 'p-4'} ${outerClassName || ''}`}
      style={style}
    >
      {/* Header row */}
      <div
        className={`flex items-center gap-2 ${collapsed ? '' : 'mb-2'}`}
      >
        <span className="text-[10px] uppercase tracking-wider text-ink-5 font-mono shrink-0">
          {typeLabel}
        </span>
        {title && (
          <span className="text-sm font-semibold text-ink truncate">
            {title}
          </span>
        )}
        <span className="flex-1" />
        {headerRight && (
          <div className="flex items-center gap-2 shrink-0">
            {headerRight}
          </div>
        )}
        {collapsible && (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="text-ink-5 hover:text-ink-3 transition-colors p-0.5 shrink-0"
            aria-label={collapsed ? 'Expand card' : 'Collapse card'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform ${collapsed ? '' : 'rotate-180'}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>

      {/* Body — hidden when collapsed */}
      {!collapsed && (
        <>
          <div className={className || ''}>
            {children}
          </div>
          {footer}
          <SourcesFooter sources={sources} />
        </>
      )}
    </div>
  );
}
