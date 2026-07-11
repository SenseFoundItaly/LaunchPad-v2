'use client';

/**
 * PanelBoundary — per-panel React error boundary.
 *
 * A render throw inside one dashboard panel used to bubble to the route-level
 * error.tsx and take down the whole page ("Failed to load project"). Wrapping
 * each panel keeps the blast radius to a muted "couldn't load" card.
 *
 * The boundary itself must be a class component (React has no hook for
 * componentDidCatch), so the exported wrapper is a small function component
 * that resolves the localized fallback and hands it to the class.
 */

import { Component, type ReactNode } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

class Boundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[PanelBoundary] panel crashed:', error);
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

export function PanelBoundary({
  children,
  fallback,
  resetKey,
}: {
  children: ReactNode;
  /** Optional custom fallback; defaults to a muted "couldn't load" card. */
  fallback?: ReactNode;
  /**
   * Remounts the boundary — clearing a caught failure — when this changes.
   * Pass the projectId on project dashboards: the App Router preserves
   * component state when only the dynamic segment changes, so without a key a
   * panel that crashed on project A keeps rendering its dead fallback on
   * project B until a full reload.
   */
  resetKey?: string;
}) {
  const t = useT();
  return (
    <Boundary
      key={resetKey}
      fallback={
        fallback ?? (
          <div
            style={{
              padding: '18px 16px',
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-l)',
              fontSize: 12,
              color: 'var(--ink-5)',
              textAlign: 'center',
              fontStyle: 'italic',
            }}
          >
            {t('common.panel-error')}
          </div>
        )
      }
    >
      {children}
    </Boundary>
  );
}
