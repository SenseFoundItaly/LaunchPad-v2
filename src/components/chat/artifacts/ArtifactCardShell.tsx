'use client';

import { useEffect, useState } from 'react';
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
  /** Show a small "AI" badge in the header to indicate AI-generated content */
  aiGenerated?: boolean;
  /**
   * When 'fallback', the artifact's sources were repaired from the response's
   * trailing <CITATIONS> block (Sonnet 4.6 omits per-artifact sources). UI
   * shows a small "sources inferred" chip so the founder knows the evidence
   * is response-level, not card-level.
   */
  provenance?: 'fallback';
  /**
   * Show an "expand to fullscreen" icon. When true, an expand affordance
   * appears in the header; clicking it opens an overlay that renders the
   * same `children` at a comfortable max-width. Default: true — the shell
   * always offers it, individual cards can opt out (e.g. solve-progress).
   */
  inspectable?: boolean;
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
  // aiGenerated intentionally not destructured — accepted for caller
  // compatibility but no longer rendered (zero-chips rule: everything on
  // the canvas is AI-generated, so the badge carried no information).
  provenance,
  inspectable = true,
}: ArtifactCardShellProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // Esc to close inspector + body-scroll-lock while it's open. The lock
  // matters because the overlay scrolls internally — without it, scrolling
  // a tall artifact bubbles up and moves the canvas underneath.
  useEffect(() => {
    if (!inspectorOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setInspectorOpen(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [inspectorOpen]);

  return (
    <div
      className={`lp-rise my-2 bg-paper-2/50 border border-line-2 rounded-lg transition-opacity ${
        dimmed ? 'opacity-40' : ''
      } ${collapsed ? 'p-2' : 'px-3 py-2.5'} ${outerClassName || ''}`}
      style={style}
    >
      {/* Header row — zero-chips rule: title + affordances only. The type
          label and AI badge were removed (everything on the canvas is
          AI-generated and a table already looks like a table); typeLabel
          survives as the title fallback + aria text. The provenance=fallback
          warning moved into SourcesFooter as a plain note. */}
      <div
        className={`flex items-center gap-2 ${collapsed ? '' : 'mb-1.5'}`}
      >
        <span className="text-sm font-semibold text-ink truncate">
          {title || typeLabel}
        </span>
        <span className="flex-1" />
        {headerRight && (
          <div className="flex items-center gap-2 shrink-0">
            {headerRight}
          </div>
        )}
        {inspectable && !collapsed && (
          <button
            type="button"
            onClick={() => setInspectorOpen(true)}
            className="text-ink-5 hover:text-ink-3 transition-colors p-0.5 shrink-0"
            aria-label="Open inspector"
            title="Open inspector"
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
            >
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
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
          <SourcesFooter sources={sources} inferredFromResponse={provenance === 'fallback'} />
        </>
      )}

      {/* Inspector overlay — same content at a comfortable max-width so dense
          artifacts (investor-pipeline, idea-canvas, risk-matrix) get the
          horizontal real estate the canvas grid can't always afford.
          Renders the body without re-mounting the card to keep any local
          card state (selected stage, expanded row) preserved. */}
      {inspectorOpen && (
        <div
          onClick={() => setInspectorOpen(false)}
          className="fixed inset-0 z-[100] flex items-center justify-center p-6"
          style={{ background: 'rgba(20, 18, 16, 0.55)' }}
          role="dialog"
          aria-modal="true"
          aria-label={`${typeLabel} inspector`}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface border border-line rounded-lg shadow-2xl flex flex-col"
            style={{
              width: 'min(1100px, 100%)',
              maxHeight: 'calc(100vh - 48px)',
            }}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
              <span className="text-sm font-semibold text-ink truncate">
                {title || typeLabel}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setInspectorOpen(false)}
                className="text-ink-5 hover:text-ink-3 transition-colors p-1"
                aria-label="Close inspector"
                title="Close (Esc)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto px-5 py-4">
              <div className={className || ''}>
                {children}
              </div>
              {footer}
              <SourcesFooter sources={sources} inferredFromResponse={provenance === 'fallback'} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
