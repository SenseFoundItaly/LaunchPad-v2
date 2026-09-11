'use client';

import { useEffect } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // This boundary renders INSIDE the project layout (which mounts
  // LocaleProvider with project.locale), so useT resolves the project
  // language; without a provider it safely falls back to English.
  const t = useT();
  useEffect(() => {
    console.error('[project-error-boundary]', error);
  }, [error]);

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h2 className="text-lg font-semibold text-ink mb-2">
          {t('error.view-title')}
        </h2>
        <p className="text-sm text-ink-4 mb-6">
          {t('error.view-body')}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 text-sm font-medium rounded-md bg-paper-2 text-ink hover:bg-paper-3 transition-colors"
          >
            {t('error.retry')}
          </button>
          <a
            href="/"
            className="px-4 py-2 text-sm font-medium rounded-md bg-paper-2 text-ink hover:bg-paper-3 transition-colors"
          >
            {t('error.all-projects')}
          </a>
        </div>
        {error.digest && (
          <p className="mt-4 text-xs text-ink-6 font-mono">
            {t('error.error-id', { digest: error.digest })}
          </p>
        )}
      </div>
    </div>
  );
}
