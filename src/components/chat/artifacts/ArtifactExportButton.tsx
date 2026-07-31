'use client';

/**
 * Per-artifact download (changelog 17/06 item 11): a small icon button in the
 * card header that exports THIS artifact in an editable format — CSV for tabular
 * artifacts, JSON otherwise (see buildArtifactExport). Renders nothing for
 * non-data artifacts. Lives in the ArtifactCardShell header next to inspect.
 */

import type { Artifact } from '@/types/artifacts';
import { buildArtifactExport } from '@/lib/artifact-export';
import { useT } from '@/components/providers/LocaleProvider';

export default function ArtifactExportButton({ artifact }: { artifact: Artifact }) {
  const t = useT();
  const payload = buildArtifactExport(artifact);
  if (!payload) return null;

  function download() {
    if (!payload) return;
    const blob = new Blob([payload.text], { type: payload.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = payload.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="text-ink-5 hover:text-ink-3 transition-colors p-0.5 shrink-0"
      aria-label={t('shell.download-file', { file: payload.filename })}
      title={t('shell.download-file', { file: payload.filename })}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </button>
  );
}
