// ============================================================================
// Builder driver contract — the boundary that makes the dual-driver bake-off
// (v0 vs E2B, with Lovable/Replit/Ploy as later drivers) a low-regret A/B.
//
// The whole Build & Launch loop (assembleMvpContext → mvp-build-spec skill →
// Build section UI → feedback/auto-iteration → mvp_builds data model) is written
// ONCE against this interface. Each driver only implements create/iterate/deploy.
// Swapping the default driver never touches the loop, UI, skills, or data model.
// ============================================================================

export type BuilderId = 'stub' | 'e2b' | 'v0' | 'lovable' | 'replit' | 'ploy';
export type BuilderLane = 'product' | 'growth';
export type BuildSubstrate = 'webcontainer' | 'e2b';

/** Identifies which build we're acting on. */
export interface BuildContextRef {
  projectId: string;
  buildId: string;
  ownerUserId?: string;
}

/** A generated builder-ready spec/prompt (produced by the mvp-build-spec skill). */
export interface BuildSpec {
  /** Imperative build prompt (kept ≤ ~45k chars by the skill). */
  prompt: string;
  /** Optional publicly-reachable reference images (some drivers accept them). */
  imageUrls?: string[];
}

export interface BuildFileChange {
  path: string;
  change: 'added' | 'modified' | 'deleted';
}

export interface BuildDiff {
  files: BuildFileChange[];
  summary?: string;
}

/** Result of creating, iterating, or deploying a build. */
export interface BuildResult {
  /** Driver-specific handle stored on mvp_builds.builder_ref (chat id, sandbox id, …). */
  builderRef: string;
  /** Iframe target for the live preview. */
  previewUrl?: string;
  /** Deployed/persisted shareable app URL. */
  liveUrl?: string;
  status: 'building' | 'live' | 'failed';
  /** What changed this turn (populated by iterate; optional on create). */
  diff?: BuildDiff;
  /** Tail of the agent/build log, for progress display. */
  logs?: string;
  error?: string;
  /** Substrate actually used (build-your-own drivers pick webcontainer vs e2b). */
  substrate?: BuildSubstrate;
  /** Driver-specific version handle (e.g. v0 latestVersion.id). On iterateAsync it
   *  carries the PRIOR version to wait past; on getStatus it carries the CURRENT
   *  version — the poller marks an iteration done when they differ + status is live. */
  versionRef?: string;
  /** Driver-specific project/container handle (e.g. v0 requires a projectId to
   *  deploy — chat must be CREATED inside it). Persisted on the build so deploy()
   *  can reference it. */
  projectRef?: string;
}

export interface BuilderAdapter {
  id: BuilderId;
  label: string;
  lane: BuilderLane;
  /** Which skill writes this builder's brief (e.g. 'mvp-build-spec'). */
  specSkillId: string;
  /** True when this driver iterates an existing build in place (vs. create-only handoff). */
  supportsIteration: boolean;
  /** Honest one-liner for UI copy about what the handoff/loop actually does. */
  notes: string;
  /** True when the driver has the env/keys it needs. The stub is always ready. */
  isConfigured(): boolean;
  /** Create a new build from a spec (SYNC — blocks to completion; used by the
   *  executor / local). Serverless callers prefer createAsync + getStatus. */
  create(ref: BuildContextRef, spec: BuildSpec): Promise<BuildResult>;
  /** Iterate an existing build with a natural-language change message (SYNC). */
  iterate(ref: BuildContextRef, builderRef: string, message: string): Promise<BuildResult>;
  /** True when create/iterate can be kicked off fast and polled via getStatus
   *  (v0, stub). False/absent → the sync create/iterate block (e2b). */
  supportsAsync?: boolean;
  /** Kick off a build and return FAST (status 'building', or 'live' for instant drivers). */
  createAsync?(ref: BuildContextRef, spec: BuildSpec): Promise<BuildResult>;
  /** Kick off an iteration and return FAST (status 'building'). */
  iterateAsync?(ref: BuildContextRef, builderRef: string, message: string): Promise<BuildResult>;
  /** Poll the current status + preview URL for an in-flight (or live) build. */
  getStatus?(ref: BuildContextRef, builderRef: string): Promise<BuildResult>;
  /** Optional: persist/deploy the current build to a shareable live URL. `opts`
   *  carries the persisted project/version handles (v0 needs both to deploy). */
  deploy?(
    ref: BuildContextRef,
    builderRef: string,
    opts?: { projectRef?: string | null; versionRef?: string | null },
  ): Promise<BuildResult>;
}
