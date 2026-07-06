'use client';

/**
 * Client-side data cache for section pages.
 *
 * Wraps the app in a single QueryClient so a fetch made on /knowledge survives
 * a navigation to /actions and back. With staleTime: Infinity, cached entries
 * never time out — they're refreshed only when something in the app explicitly
 * invalidates them via the lp-*-changed window events bridged below.
 *
 * Query key convention: [<topic>, projectId, ...detail]
 *   ['project',     projectId]
 *   ['knowledge',   projectId, 'graph']
 *   ['knowledge',   projectId, 'facts', tab]
 *   ['actions',     projectId, ...filters]
 *   ['actions',     projectId, 'count']        // inbox badge
 *   ['timeline',    projectId, days]
 *   ['workflow',    projectId]
 *   ['scoring',     projectId]
 *
 * The topic prefix is what the event bridge invalidates by, so any query
 * starting with ['knowledge', ...] flushes when lp-knowledge-changed fires.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { EVENT_TO_TOPICS } from '@/lib/query-events';

// Status-aware retry: 4xx responses (auth, not-found, validation) are
// deterministic — retrying just delays the error UI. Transient failures
// (network, 5xx, timeouts) get 2 retries with the default backoff.
// Axios errors carry `response.status`; plain fetch-based queryFns throw
// bare Errors (no status) and are treated as transient.
function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) return false;
  return failureCount < 2;
}

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Event-only invalidation: never go stale on a timer or remount.
            // Cache survives section-to-section navigation; only explicit
            // invalidateQueries() from the bridge below refetches.
            staleTime: Infinity,
            gcTime: 1000 * 60 * 30,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: retryUnlessClientError,
          },
        },
      }),
  );

  // Bridge: window CustomEvents → TanStack invalidation. Each lp-*-changed
  // event maps to one or more query-key prefixes (see lib/query-events.ts).
  // Invalidation respects projectId when the event carries one in detail —
  // a chat in project A shouldn't invalidate project B's cached actions.
  useEffect(() => {
    const handlers: Array<{ name: string; fn: EventListener }> = [];

    for (const [eventName, topics] of Object.entries(EVENT_TO_TOPICS)) {
      const fn: EventListener = (e) => {
        const detail = (e as CustomEvent<{ projectId?: string }>).detail;
        const projectId = detail?.projectId;
        for (const topic of topics) {
          client.invalidateQueries({
            queryKey: projectId ? [topic, projectId] : [topic],
            // exact: false is the default — invalidate every query whose key
            // starts with this prefix. That's how one event flushes the
            // knowledge graph AND the facts review list AND the entity count
            // without each call site knowing about the others.
          });
        }
      };
      window.addEventListener(eventName, fn);
      handlers.push({ name: eventName, fn });
    }

    return () => {
      for (const { name, fn } of handlers) window.removeEventListener(name, fn);
    };
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
