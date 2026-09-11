'use client';

import { useEffect } from 'react';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[root-error-boundary]', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-sunk px-6">
      <div className="max-w-md text-center">
        <h2 className="text-lg font-semibold text-ink mb-2">
          Something went wrong
        </h2>
        <p className="text-sm text-ink-4 mb-6">
          An unexpected error occurred. You can try again or go back to the home page.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 text-sm font-medium rounded-md bg-paper-2 text-ink hover:bg-paper-3 transition-colors"
          >
            Try again
          </button>
          <a
            href="/"
            className="px-4 py-2 text-sm font-medium rounded-md bg-paper-2 text-ink hover:bg-paper-3 transition-colors"
          >
            Home
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
