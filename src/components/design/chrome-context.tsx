'use client';

/**
 * Chrome context — lets the persistent project layout chrome (TopBar + NavRail +
 * StatusBar, rendered once in layout.tsx so it survives tab navigation) receive
 * the per-page bits that vary by route: the TopBar breadcrumb + right-content,
 * the StatusBar props, and whether the chat is streaming (NavRail pulse).
 *
 * Each page calls `useSetChrome({...}, [deps])` to publish its bits; the layout
 * reads them via `useChromeState()`. Because the layout persists, switching tabs
 * no longer re-mounts the chrome — only the content slot re-mounts (keyed on
 * pathname) and crossfades. A page that publishes nothing leaves the layout's
 * pathname-derived fallbacks in place.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { StatusBarProps } from './primitives';

export interface ChromeState {
  breadcrumb?: string[];
  /** TopBar right-content (page-specific live pills/badges). */
  right?: ReactNode;
  /** StatusBar props for this page. */
  status?: StatusBarProps;
  /** Pulse the Co-pilot nav icon while the chat streams. */
  chatStreaming?: boolean;
}

interface ChromeCtx {
  state: ChromeState;
  set: (s: ChromeState) => void;
}

const Ctx = createContext<ChromeCtx | null>(null);

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ChromeState>({});
  return <Ctx.Provider value={{ state, set: setState }}>{children}</Ctx.Provider>;
}

/** Layout reads the current page's published chrome bits. */
export function useChromeState(): ChromeState {
  return useContext(Ctx)?.state ?? {};
}

/**
 * Pages publish their chrome bits. Pass a deps array so live values (counts,
 * streaming state) re-publish when they change — exactly like a useEffect dep
 * list. The chrome resets to {} on unmount so a tab that publishes nothing
 * doesn't inherit the previous tab's right-content.
 */
export function useSetChrome(chrome: ChromeState, deps: unknown[]): void {
  const ctx = useContext(Ctx);
  useEffect(() => {
    ctx?.set(chrome);
    return () => ctx?.set({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
