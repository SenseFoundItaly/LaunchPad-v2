// ============================================================================
// v0 driver — Vercel v0 Platform API (v0-sdk).
//
// create()  → chats.create({ message: spec.prompt })  (a private v0 chat)
// iterate() → chats.sendMessage({ chatId, message })   (continue the chat)
// preview   → chat.latestVersion.demoUrl (embed in the iframe)
// files     → chat.latestVersion.files   (available for self-hosting = full white-label)
//
// Auth: V0_API_KEY. Cost (v0 build credits) lands on our Vercel account → gate on
// isProjectCapped upstream. Key-gated: isConfigured() is false without the key,
// so the registry can fall back to the stub without breaking anything.
// ============================================================================

import { createClient } from 'v0-sdk';
import type { BuilderAdapter, BuildContextRef, BuildResult, BuildSpec } from './types';

function client() {
  return createClient({ apiKey: process.env.V0_API_KEY });
}

// Structural subset of the SDK's ChatDetail we actually read (the create/send
// responses are `ChatDetail | ReadableStream`; responseMode:'sync' returns the
// object, and we narrow via cast).
interface ChatLike {
  id: string;
  webUrl?: string;
  latestVersion?: { status?: string; demoUrl?: string };
}

function toResult(chat: ChatLike): BuildResult {
  const status = chat.latestVersion?.status;
  return {
    builderRef: chat.id,
    previewUrl: chat.latestVersion?.demoUrl,
    liveUrl: chat.webUrl,
    status: status === 'failed' ? 'failed' : status === 'completed' ? 'live' : 'building',
  };
}

export const v0Adapter: BuilderAdapter = {
  id: 'v0',
  label: 'v0 (Vercel)',
  lane: 'product',
  specSkillId: 'mvp-build-spec',
  supportsIteration: true,
  notes: 'v0 Platform API — creates + iterates a chat; embed the demo, self-host chat.files for full white-label.',
  isConfigured: () => !!process.env.V0_API_KEY,

  async create(_ref: BuildContextRef, spec: BuildSpec): Promise<BuildResult> {
    const res = await client().chats.create({
      message: spec.prompt,
      chatPrivacy: 'private',
      responseMode: 'sync',
      ...(spec.imageUrls?.length ? { attachments: spec.imageUrls.map((url) => ({ url })) } : {}),
    });
    return toResult(res as unknown as ChatLike);
  },

  async iterate(_ref: BuildContextRef, builderRef: string, message: string): Promise<BuildResult> {
    if (!builderRef) throw new Error('v0 iterate: missing chat id (builder_ref)');
    const res = await client().chats.sendMessage({
      chatId: builderRef,
      message,
      responseMode: 'sync',
    });
    return {
      ...toResult(res as unknown as ChatLike),
      diff: { files: [], summary: message.slice(0, 160) },
    };
  },
};
