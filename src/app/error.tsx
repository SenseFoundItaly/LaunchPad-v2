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
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6">
      <div className="max-w-md text-center">
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">
          Something went wrong
        </h2>
        <p className="text-sm text-zinc-400 mb-6">
          An unexpected error occurred. You can try again or go back to the home page.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 text-sm font-medium rounded-md bg-zinc-800 text-zinc-100 hover:bg-zinc-700 transition-colors"
          >
            Try again
          </button>
          <a
            href="/"
            className="px-4 py-2 text-sm font-medium rounded-md bg-zinc-800 text-zinc-100 hover:bg-zinc-700 transition-colors"
          >
            Home
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
