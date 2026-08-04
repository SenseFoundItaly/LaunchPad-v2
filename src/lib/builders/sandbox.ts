// ============================================================================
// E2B sandbox lifecycle for the build-your-own driver.
//
// Writes the generated app into an E2B microVM and serves it on a public port,
// returning a URL we embed in the Build section's iframe. Static-first: a simple
// HTTP server hosts the generated files (no build step). Full-stack (dev server,
// DB, auth) is a follow-up — see notes in e2b-agent.ts.
// ============================================================================

import { Sandbox } from 'e2b';

export interface GenFile {
  path: string;
  content: string;
}

export interface SandboxHandle {
  sandboxId: string;
  previewUrl: string;
}

const PORT = 3000;
const APP_DIR = '/home/user/app';
const TIMEOUT_MS = 10 * 60_000; // sandbox stays warm 10 min; persistence is a follow-up

function apiKey(): string | undefined {
  return process.env.E2B_API_KEY;
}

async function writeApp(sandbox: Sandbox, files: GenFile[]): Promise<void> {
  const entries = files.map((f) => ({
    path: `${APP_DIR}/${f.path.replace(/^\/+/, '')}`,
    data: f.content,
  }));
  await sandbox.files.write(entries);
}

async function serveApp(sandbox: Sandbox): Promise<void> {
  // Background static server. Uses python3 from the base template so there is no
  // install step. `|| true` keeps a re-serve idempotent if a server is already up.
  await sandbox.commands.run(
    `sh -c 'cd ${APP_DIR} && (python3 -m http.server ${PORT} >/tmp/serve.log 2>&1 &)' || true`,
    { background: true },
  );
}

/** Create a sandbox, write the app, serve it, return the embeddable URL. */
export async function createSiteSandbox(files: GenFile[]): Promise<SandboxHandle> {
  const sandbox = await Sandbox.create({ apiKey: apiKey(), timeoutMs: TIMEOUT_MS });
  await writeApp(sandbox, files);
  await serveApp(sandbox);
  return { sandboxId: sandbox.sandboxId, previewUrl: `https://${sandbox.getHost(PORT)}` };
}

/** Reconnect to an existing sandbox, rewrite the app, return the URL. */
export async function updateSiteSandbox(sandboxId: string, files: GenFile[]): Promise<SandboxHandle> {
  const sandbox = await Sandbox.connect(sandboxId, { apiKey: apiKey() });
  await writeApp(sandbox, files);
  await serveApp(sandbox);
  return { sandboxId, previewUrl: `https://${sandbox.getHost(PORT)}` };
}

/**
 * Read the current app files back out of a sandbox so an iteration can PATCH them
 * rather than regenerate blind. One level under APP_DIR (the generator emits flat
 * sibling files); bounded to keep the follow-up prompt sane.
 */
export async function readSiteFiles(sandboxId: string, maxFiles = 20): Promise<GenFile[]> {
  const sandbox = await Sandbox.connect(sandboxId, { apiKey: apiKey() });
  const listed = await sandbox.files.list(APP_DIR).catch(() => [] as Array<{ name?: string; path?: string; type?: string }>);
  const out: GenFile[] = [];
  for (const entry of listed) {
    if (entry.type && entry.type !== 'file') continue;
    const p = entry.path ?? `${APP_DIR}/${entry.name ?? ''}`;
    try {
      const content = await sandbox.files.read(p);
      if (typeof content === 'string') {
        out.push({ path: p.replace(`${APP_DIR}/`, '').replace(/^\/+/, ''), content });
      }
    } catch {
      /* skip unreadable entry */
    }
    if (out.length >= maxFiles) break;
  }
  return out;
}
