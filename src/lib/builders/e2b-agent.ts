// ============================================================================
// E2B "build-your-own" driver.
//
// This is the fully-agentic, native-to-LaunchPad path: the SAME Claude runtime
// (runAgent) that powers chat/skills generates the app, and an E2B sandbox hosts
// the live preview we embed. White-label by construction (our code, our sandbox).
//
// FIRST CUT (static-first): runAgent emits a small self-contained static site;
// the sandbox serves it. iterate READS the prior files from the sandbox and
// patches them (not a blind regen). Follow-ups (flagged): (1) full-stack apps
// (dev server + DB) instead of static; (2) a real plan→build→run→read-errors→
// self-correct loop; (3) persist/snapshot for a durable live URL; (4) an async
// surface (createAsync/getStatus + a background worker) so E2B is serverless-safe
// like v0 — today it is sync and must run where a long function is allowed.
// Key-gated on E2B_API_KEY.
// ============================================================================

import { runAgent } from '@/lib/pi-agent';
import type { BuilderAdapter, BuildContextRef, BuildResult, BuildSpec } from './types';
import { createSiteSandbox, updateSiteSandbox, readSiteFiles, type GenFile } from './sandbox';

/** Cap the current-files context injected into an iteration prompt (chars). */
const MAX_PRIOR_CONTEXT = 60_000;

const GEN_SYSTEM = `You are a senior web engineer. Build a small, self-contained static web app (HTML/CSS/vanilla JS — NO build step, NO frameworks that need bundling) that implements the given product spec as closely as possible.

Output ONLY a JSON object of this exact shape and nothing else:
{"files":[{"path":"index.html","content":"<!doctype html>..."}]}

Rules:
- MUST include an "index.html" entrypoint at the root.
- Everything must run when served by a plain static file server (open index.html).
- Inline CSS/JS or reference sibling files you also emit. No npm, no imports from a bundler.
- Make it look intentional and match any brand direction in the spec.`;

interface GenPayload {
  files?: unknown;
}

function extractJson(text: string): GenPayload | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as GenPayload;
  } catch {
    return null;
  }
}

async function generateFiles(instruction: string, projectId: string): Promise<GenFile[]> {
  const res = await runAgent(`${instruction}\n\nReturn the JSON files object now.`, {
    systemPrompt: GEN_SYSTEM,
    tools: false,
    projectId,
    step: 'build.e2b',
    timeout: 150_000,
  });
  const parsed = extractJson(res.text);
  const files = Array.isArray(parsed?.files) ? parsed!.files : [];
  return (files as unknown[]).filter(
    (f): f is GenFile =>
      !!f && typeof (f as GenFile).path === 'string' && typeof (f as GenFile).content === 'string',
  );
}

export const e2bAdapter: BuilderAdapter = {
  id: 'e2b',
  label: 'E2B (build-your-own)',
  lane: 'product',
  specSkillId: 'mvp-build-spec',
  supportsIteration: true,
  notes: 'Build-your-own: Claude generates the app, an E2B sandbox hosts the live preview. Static-first; full-stack is a follow-up.',
  isConfigured: () => !!process.env.E2B_API_KEY,

  async create(ref: BuildContextRef, spec: BuildSpec): Promise<BuildResult> {
    const files = await generateFiles(`Spec:\n\n${spec.prompt}`, ref.projectId);
    if (files.length === 0) {
      return { builderRef: '', status: 'failed', error: 'The build agent produced no files.' };
    }
    const h = await createSiteSandbox(files);
    return {
      builderRef: h.sandboxId,
      previewUrl: h.previewUrl,
      status: 'live',
      substrate: 'e2b',
      diff: { files: files.map((f) => ({ path: f.path, change: 'added' as const })) },
    };
  },

  async iterate(ref: BuildContextRef, builderRef: string, message: string): Promise<BuildResult> {
    if (!builderRef) throw new Error('e2b iterate: missing sandbox id (builder_ref)');
    // PATCH-based iteration: read the current files back from the sandbox and give
    // them to the agent so it EDITS the app rather than regenerating blind. Falls
    // back to a clean regen if the files can't be read or are too large to inject.
    const prior = await readSiteFiles(builderRef).catch(() => [] as GenFile[]);
    const priorText = prior.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');
    const priorBlock =
      prior.length && priorText.length <= MAX_PRIOR_CONTEXT
        ? `Here are the CURRENT files of the app:\n\n${priorText}\n\n`
        : '';
    const instruction = `${priorBlock}Apply this change to the app: ${message}\n\nReturn the COMPLETE updated file set (every file the app needs to run, with the change applied) in the same JSON shape — not just a diff.`;
    const files = await generateFiles(instruction, ref.projectId);
    if (files.length === 0) {
      return { builderRef, status: 'failed', error: 'The build agent produced no files.' };
    }
    const priorPaths = new Set(prior.map((f) => f.path));
    const h = await updateSiteSandbox(builderRef, files);
    return {
      builderRef: h.sandboxId,
      previewUrl: h.previewUrl,
      status: 'live',
      substrate: 'e2b',
      diff: {
        files: files.map((f) => ({
          path: f.path,
          change: priorPaths.has(f.path) ? ('modified' as const) : ('added' as const),
        })),
      },
    };
  },
};
