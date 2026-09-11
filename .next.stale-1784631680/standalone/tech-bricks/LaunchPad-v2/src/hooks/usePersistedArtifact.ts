import { useEffect, useState } from 'react';
import type { ReviewedState } from '@/types/artifacts';

interface PersistedInfo {
  persisted_id: string;
  reviewed_state: ReviewedState;
}

// Session registry of every broadcast map. The window event alone is missed by
// cards that MOUNT AFTER it fires — exactly the skill:run case, where the
// artifact cards render from the final summary in the same tick as the done
// event. Broadcasters merge here first; the hook seeds from it on mount.
const registry: Record<string, PersistedInfo> = {};

/** Merge a done-event map into the registry and notify mounted listeners. */
export function broadcastPersistedArtifacts(map: Record<string, PersistedInfo>) {
  Object.assign(registry, map);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lp-persisted-artifacts', { detail: map }));
  }
}

/**
 * Hook that listens for the `lp-persisted-artifacts` CustomEvent emitted by
 * useChat when the done event arrives with server-assigned IDs. Returns the
 * persisted_id and reviewed_state for the given artifact id, merging with
 * any value already present on the artifact props.
 */
export function usePersistedArtifact(artifactId: string, initial?: {
  persisted_id?: string;
  reviewed_state?: ReviewedState;
}): PersistedInfo | null {
  const [info, setInfo] = useState<PersistedInfo | null>(
    () =>
      (artifactId && registry[artifactId]) ||
      (initial?.persisted_id
        ? { persisted_id: initial.persisted_id, reviewed_state: initial.reviewed_state ?? 'pending' }
        : null),
  );

  useEffect(() => {
    // Catch a broadcast that landed between render and effect registration.
    if (artifactId && registry[artifactId]) setInfo(registry[artifactId]);
    function handleEvent(e: Event) {
      const detail = (e as CustomEvent).detail as Record<string, PersistedInfo> | undefined;
      if (detail && artifactId && detail[artifactId]) {
        setInfo(detail[artifactId]);
      }
    }
    window.addEventListener('lp-persisted-artifacts', handleEvent);
    return () => window.removeEventListener('lp-persisted-artifacts', handleEvent);
  }, [artifactId]);

  return info;
}
