// ============================================================================
// v0 driver — Vercel v0 Platform API (v0-sdk).
//
// v0 builds take 1–2.5 min, so the primary path is ASYNC:
//   createAsync  → chats.create({ responseMode:'async' })   returns fast, status 'building'
//   iterateAsync → chats.sendMessage({ responseMode:'async' }) returns fast
//   getStatus    → chats.getById → latestVersion.{status,demoUrl,id}  (polled to completion)
// This keeps every serverless function call short. The SYNC create/iterate remain
// for local / the cron executor. preview = latestVersion.demoUrl (embed in iframe);
// getStatus re-reads it so the expiring __v0_token stays fresh.
// Auth: V0_API_KEY. Key-gated via isConfigured().
// ============================================================================

import { createClient } from 'v0-sdk';
import type { BuilderAdapter, BuildContextRef, BuildResult, BuildSpec } from './types';

function client() {
  return createClient({ apiKey: process.env.V0_API_KEY });
}

// Structural subset of the SDK's ChatDetail we read (responses are typed
// `ChatDetail | ReadableStream`; we narrow via cast).
interface ChatLike {
  id: string;
  webUrl?: string;
  latestVersion?: { id?: string; status?: string; demoUrl?: string };
}

function toResult(chat: ChatLike): BuildResult {
  const status = chat.latestVersion?.status;
  return {
    builderRef: chat.id,
    previewUrl: chat.latestVersion?.demoUrl,
    // NOTE: chat.webUrl is the v0 *editor* page ("view this chat in the browser"),
    // NOT a hosted app — surfacing it would drop the founder into v0's branded UI.
    // A white-label live URL only exists after deploy() (POST /v1/deployments).
    liveUrl: undefined,
    versionRef: chat.latestVersion?.id,
    status: status === 'failed' ? 'failed' : status === 'completed' ? 'live' : 'building',
  };
}

function attach(spec: BuildSpec) {
  return spec.imageUrls?.length ? { attachments: spec.imageUrls.map((url) => ({ url })) } : {};
}

export const v0Adapter: BuilderAdapter = {
  id: 'v0',
  label: 'v0 (Vercel)',
  lane: 'product',
  specSkillId: 'mvp-build-spec',
  supportsIteration: true,
  supportsAsync: true,
  notes: 'v0 Platform API — creates + iterates a chat; embed demoUrl for preview, POST /v1/deployments (+ a custom domain in the v0/Vercel dashboard) for a white-label hosted app.',
  isConfigured: () => !!process.env.V0_API_KEY,

  // ── SYNC (local / executor) ───────────────────────────────────────────────
  async create(ref: BuildContextRef, spec: BuildSpec): Promise<BuildResult> {
    // Bind the chat to a fresh v0 project so it can be deployed later (verified
    // via a live 409: deploy requires the chat to be CREATED inside the project).
    const project = (await client().projects.create({ name: projectName(ref) })) as unknown as { id: string };
    const res = await client().chats.create({ message: spec.prompt, chatPrivacy: 'private', responseMode: 'sync', projectId: project.id, ...attach(spec) });
    return { ...toResult(res as unknown as ChatLike), projectRef: project.id };
  },
  async iterate(_ref: BuildContextRef, builderRef: string, message: string): Promise<BuildResult> {
    if (!builderRef) throw new Error('v0 iterate: missing chat id (builder_ref)');
    const res = await client().chats.sendMessage({ chatId: builderRef, message, responseMode: 'sync' });
    return { ...toResult(res as unknown as ChatLike), diff: { files: [], summary: message.slice(0, 160) } };
  },

  // ── ASYNC (serverless — kick off fast, poll getStatus) ────────────────────
  async createAsync(ref: BuildContextRef, spec: BuildSpec): Promise<BuildResult> {
    const project = (await client().projects.create({ name: projectName(ref) })) as unknown as { id: string };
    const res = await client().chats.create({ message: spec.prompt, chatPrivacy: 'private', responseMode: 'async', projectId: project.id, ...attach(spec) });
    return { ...toResult(res as unknown as ChatLike), status: 'building', projectRef: project.id };
  },
  async iterateAsync(_ref: BuildContextRef, builderRef: string, message: string): Promise<BuildResult> {
    if (!builderRef) throw new Error('v0 iterate: missing chat id (builder_ref)');
    // Capture the version we're iterating past so the poller knows when the NEW one lands.
    const before = (await client().chats.getById({ chatId: builderRef })) as unknown as ChatLike;
    const priorVersion = before.latestVersion?.id;
    await client().chats.sendMessage({ chatId: builderRef, message, responseMode: 'async' });
    return { builderRef, status: 'building', versionRef: priorVersion, diff: { files: [], summary: message.slice(0, 160) } };
  },
  async getStatus(_ref: BuildContextRef, builderRef: string): Promise<BuildResult> {
    const res = await client().chats.getById({ chatId: builderRef });
    return toResult(res as unknown as ChatLike);
  },

  // ── DEPLOY (white-label) ──────────────────────────────────────────────────
  // v0's documented white-label path: deploy the current version to Vercel → hosted
  // webUrl. A v0 deployment belongs to a PROJECT, and (VERIFIED via a live 409 —
  // "Chat and project do not match") the chat must be CREATED inside that project.
  // So create()/createAsync() bind the chat to a fresh project + persist projectRef;
  // deploy() reads it back here. Custom domain is bound in the v0/Vercel dashboard
  // afterward (no domain field on the deploy response).
  async deploy(
    _ref: BuildContextRef,
    builderRef: string,
    opts?: { projectRef?: string | null; versionRef?: string | null },
  ): Promise<BuildResult> {
    if (!builderRef) throw new Error('v0 deploy: missing chat id (builder_ref)');
    const projectId = opts?.projectRef;
    if (!projectId) {
      throw new Error('v0 deploy: missing project ref (build was not created inside a v0 project)');
    }
    let versionId = opts?.versionRef ?? undefined;
    if (!versionId) {
      const chat = (await client().chats.getById({ chatId: builderRef })) as unknown as ChatLike;
      versionId = chat.latestVersion?.id;
    }
    if (!versionId) throw new Error('v0 deploy: no completed version to deploy yet');
    // A v0 deployment targets a Vercel project — link one to the v0 project first
    // (verified: deployments.create 500s without it). Requires the v0 account to have
    // Vercel connected; "already linked" is fine.
    try {
      await client().integrations.vercel.projects.create({ projectId, name: `launchpad-${builderRef.slice(0, 16)}` });
    } catch (e) {
      const m = (e as Error).message || '';
      if (!/exist|already|conflict|409/i.test(m)) {
        throw new Error(`v0 deploy: could not link a Vercel project (is Vercel connected to your v0 account?): ${m}`);
      }
    }
    const dep = await client().deployments.create({ projectId, chatId: builderRef, versionId });
    return { builderRef, status: 'live', liveUrl: dep.webUrl };
  },
};

/** v0 project name for a build — bounded, deterministic per build. */
function projectName(ref: BuildContextRef): string {
  return `launchpad-${ref.buildId}`.slice(0, 60);
}
