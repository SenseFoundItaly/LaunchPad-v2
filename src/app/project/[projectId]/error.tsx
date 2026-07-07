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
        <h2 className="text-lg font-semibold text-ink mb-2">
          This view hit an error
        </h2>
        <p className="text-sm text-ink-4 mb-6">
          Something went wrong rendering this section — the rest of your project is fine.
          Retry, switch tabs, or return to your projects list.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 text-sm font-medium rounded-md bg-paper-2 text-ink hover:bg-paper-3 transition-colors"
          >
            Retry
          </button>
          <a
            href="/"
            className="px-4 py-2 text-sm font-medium rounded-md bg-paper-2 text-ink hover:bg-paper-3 transition-colors"
          >
            All projects
          </a>
        </div>
        {error.digest && (
          <p className="mt-4 text-xs text-ink-6 font-mono">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
