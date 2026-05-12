import { useEffect, useState } from 'react';
import type { ReviewedState } from '@/types/artifacts';

interface PersistedInfo {
  persisted_id: string;
  reviewed_state: ReviewedState;
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
    initial?.persisted_id
      ? { persisted_id: initial.persisted_id, reviewed_state: initial.reviewed_state ?? 'pending' }
      : null,
  );

  useEffect(() => {
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
