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

// Drivers registered on this branch. v0/e2b/lovable/replit/ploy adapters are
// added on their own branches (register them here when they land).
const REGISTRY: Partial<Record<BuilderId, BuilderAdapter>> = {
  stub: stubAdapter,
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
