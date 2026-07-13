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
  async create(_ref: BuildContextRef, spec: BuildSpec): Promise<BuildResult> {
    const res = await client().chats.create({ message: spec.prompt, chatPrivacy: 'private', responseMode: 'sync', ...attach(spec) });
    return toResult(res as unknown as ChatLike);
  },
  async iterate(_ref: BuildContextRef, builderRef: string, message: string): Promise<BuildResult> {
    if (!builderRef) throw new Error('v0 iterate: missing chat id (builder_ref)');
    const res = await client().chats.sendMessage({ chatId: builderRef, message, responseMode: 'sync' });
    return { ...toResult(res as unknown as ChatLike), diff: { files: [], summary: message.slice(0, 160) } };
  },

  // ── ASYNC (serverless — kick off fast, poll getStatus) ────────────────────
  async createAsync(_ref: BuildContextRef, spec: BuildSpec): Promise<BuildResult> {
    const res = await client().chats.create({ message: spec.prompt, chatPrivacy: 'private', responseMode: 'async', ...attach(spec) });
    return { ...toResult(res as unknown as ChatLike), status: 'building' };
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
};
