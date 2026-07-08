// ============================================================================
// Stub builder driver — no external calls.
//
// Lets the shared Build & Launch core (UI, API, feedback loop, data model) be
// built and E2E-tested before the real v0 / E2B drivers exist. `create` and
// `iterate` return a self-contained `data:` HTML preview (renders in the iframe
// with no network), plus a fake file diff so the change-list UI has something to
// show. Selected via BUILD_DRIVER=stub (the default when nothing is configured).
// ============================================================================

import type {
  BuilderAdapter,
  BuildContextRef,
  BuildResult,
  BuildSpec,
} from './types';

function dataPreview(title: string, body: string): string {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:40px;background:#0b0d10;color:#e8eaed}
h1{font-size:20px;margin:0 0 6px}.tag{display:inline-block;font-size:12px;color:#8b98a5;border:1px solid #2a2f36;border-radius:6px;padding:2px 8px;margin-bottom:20px}
pre{white-space:pre-wrap;background:#12151a;border:1px solid #2a2f36;border-radius:8px;padding:16px;color:#c8cdd4}</style></head>
<body><span class="tag">stub preview</span><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(body)}</pre></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}

export const stubAdapter: BuilderAdapter = {
  id: 'stub',
  label: 'Stub (dev)',
  lane: 'product',
  specSkillId: 'mvp-build-spec',
  supportsIteration: true,
  notes: 'Local stub driver — renders a self-contained preview, makes no external calls.',
  isConfigured: () => true,

  async create(ref: BuildContextRef, spec: BuildSpec): Promise<BuildResult> {
    return {
      builderRef: `stub_${ref.buildId}`,
      previewUrl: dataPreview('MVP preview (created)', spec.prompt.slice(0, 4000)),
      status: 'live',
      diff: { files: [{ path: 'app/page.tsx', change: 'added' }], summary: 'Scaffolded from spec.' },
      logs: 'stub: scaffolded project from spec',
      substrate: 'webcontainer',
    };
  },

  async iterate(ref: BuildContextRef, builderRef: string, message: string): Promise<BuildResult> {
    return {
      builderRef,
      previewUrl: dataPreview('MVP preview (iterated)', `Change requested:\n\n${message}`),
      status: 'live',
      diff: {
        files: [{ path: 'app/page.tsx', change: 'modified' }],
        summary: `Applied: ${message.slice(0, 120)}`,
      },
      logs: 'stub: applied iteration message',
      substrate: 'webcontainer',
    };
  },

  async deploy(ref: BuildContextRef, builderRef: string): Promise<BuildResult> {
    return {
      builderRef,
      liveUrl: `https://stub.local/${builderRef}`,
      status: 'live',
      logs: 'stub: deployed',
    };
  },
};
