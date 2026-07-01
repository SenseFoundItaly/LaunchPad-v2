'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Project index → resume-where-you-were.
 *
 * The layout persists the last-open sub-route in localStorage
 * (`lp:last-route:{id}`). Opening a project bounces to that route, falling back
 * to the spine (`today`) for brand-new projects or when storage is unavailable.
 * Client-side because localStorage isn't readable on the server.
 */
export default function ProjectIndex({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();

  useEffect(() => {
    let seg = 'today';
    try {
      const saved = localStorage.getItem(`lp:last-route:${projectId}`);
      if (saved) seg = saved;
    } catch {
      /* storage disabled — fall back to the spine */
    }
    router.replace(`/project/${projectId}/${seg}`);
  }, [projectId, router]);

  return null;
}
