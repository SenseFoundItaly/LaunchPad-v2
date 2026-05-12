'use client';

import { useEffect } from 'react';

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[project-error-boundary]', error);
  }, [error]);

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">
          Failed to load project
        </h2>
        <p className="text-sm text-zinc-400 mb-6">
          Something went wrong loading this project. Try again or return to your projects list.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 text-sm font-medium rounded-md bg-zinc-800 text-zinc-100 hover:bg-zinc-700 transition-colors"
          >
            Retry
          </button>
          <a
            href="/"
            className="px-4 py-2 text-sm font-medium rounded-md bg-zinc-800 text-zinc-100 hover:bg-zinc-700 transition-colors"
          >
            All projects
          </a>
        </div>
        {error.digest && (
          <p className="mt-4 text-xs text-zinc-600 font-mono">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
