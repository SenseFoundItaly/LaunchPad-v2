// ============================================================================
// Builder registry — resolves the active driver behind the BuilderAdapter.
//
// The default driver is chosen by the BUILD_DRIVER env var (falls back to
// 'stub'). Real drivers (v0, e2b) are added on their respective branches by
// importing their adapter and registering it here — one line each. Nothing else
// in the Build & Launch loop knows which driver is active.
// ============================================================================

import type { BuilderAdapter, BuilderId } from './types';
import { stubAdapter } from './stub';
import { v0Adapter } from './v0';
import { e2bAdapter } from './e2b-agent';

// Registered drivers. Selection is by BUILD_DRIVER env (default 'stub'); v0/e2b
// only actually run when their API key is set (isConfigured()). Importing them is
// cheap — the SDK clients/sandboxes are constructed lazily inside their methods.
const REGISTRY: Partial<Record<BuilderId, BuilderAdapter>> = {
  stub: stubAdapter,
  v0: v0Adapter,
  e2b: e2bAdapter,
};

/** The configured default driver id (env-overridable; 'stub' when unset). */
export function activeBuilderId(): BuilderId {
  const fromEnv = process.env.BUILD_DRIVER as BuilderId | undefined;
  if (fromEnv && REGISTRY[fromEnv]) return fromEnv;
  return 'stub';
}

/** Look up a specific driver; throws if it isn't registered on this branch. */
export function getBuilder(id: BuilderId): BuilderAdapter {
  const adapter = REGISTRY[id];
  if (!adapter) {
    throw new Error(
      `Builder driver "${id}" is not registered on this branch (available: ${Object.keys(REGISTRY).join(', ')}).`
    );
  }
  return adapter;
}

/** The active default driver instance. */
export function getActiveBuilder(): BuilderAdapter {
  return getBuilder(activeBuilderId());
}

/** All drivers registered on this branch. */
export function listBuilders(): BuilderAdapter[] {
  return Object.values(REGISTRY).filter(Boolean) as BuilderAdapter[];
}
