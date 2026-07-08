// ============================================================================
// Data access for the Build & Launch Hub tables (mvp_builds, mvp_build_feedback).
// "Current build" for a project = the row with the highest `iteration`.
// JSONB (`metadata`) is bound RAW — never JSON.stringify (double-encode footgun).
// ============================================================================

import { query, get, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';

export interface MvpBuild {
  id: string;
  project_id: string;
  lane: string;
  builder: string;
  substrate: string | null;
  builder_ref: string | null;
  iteration: number;
  status: string;
  spec_prompt: string | null;
  spec_artifact_id: string | null;
  preview_url: string | null;
  live_app_url: string | null;
  watch_source_id: string | null;
  parent_build_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface MvpBuildFeedback {
  id: string;
  project_id: string;
  build_id: string | null;
  source: string;
  source_ref_id: string | null;
  body: string;
  severity: string | null;
  incorporated_in_iteration: number | null;
  created_at: string;
}

export async function getCurrentBuild(projectId: string): Promise<MvpBuild | undefined> {
  return get<MvpBuild>(
    'SELECT * FROM mvp_builds WHERE project_id = ? ORDER BY iteration DESC LIMIT 1',
    projectId,
  );
}

export async function getBuild(buildId: string): Promise<MvpBuild | undefined> {
  return get<MvpBuild>('SELECT * FROM mvp_builds WHERE id = ?', buildId);
}

export async function listBuilds(projectId: string): Promise<MvpBuild[]> {
  return query<MvpBuild>(
    'SELECT * FROM mvp_builds WHERE project_id = ? ORDER BY iteration DESC',
    projectId,
  );
}

export interface CreateBuildInput {
  projectId: string;
  builder: string;
  lane?: string;
  substrate?: string | null;
  builderRef?: string | null;
  status?: string;
  specPrompt?: string | null;
  specArtifactId?: string | null;
  previewUrl?: string | null;
  liveAppUrl?: string | null;
  parentBuildId?: string | null;
  /** Explicit iteration; when omitted it is current+1 (or 1 for the first build). */
  iteration?: number;
  metadata?: Record<string, unknown>;
}

export async function createBuild(input: CreateBuildInput): Promise<MvpBuild> {
  const iteration =
    input.iteration ??
    ((await getCurrentBuild(input.projectId))?.iteration ?? 0) + 1;
  const id = generateId('mvpb');
  const rows = await run(
    `INSERT INTO mvp_builds
       (id, project_id, lane, builder, substrate, builder_ref, iteration, status,
        spec_prompt, spec_artifact_id, preview_url, live_app_url, parent_build_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    id,
    input.projectId,
    input.lane ?? 'product',
    input.builder,
    input.substrate ?? null,
    input.builderRef ?? null,
    iteration,
    input.status ?? 'draft',
    input.specPrompt ?? null,
    input.specArtifactId ?? null,
    input.previewUrl ?? null,
    input.liveAppUrl ?? null,
    input.parentBuildId ?? null,
    input.metadata ?? {},
  );
  return rows[0] as unknown as MvpBuild;
}

const UPDATABLE_COLUMNS: Record<string, string> = {
  status: 'status',
  builderRef: 'builder_ref',
  substrate: 'substrate',
  specPrompt: 'spec_prompt',
  specArtifactId: 'spec_artifact_id',
  previewUrl: 'preview_url',
  liveAppUrl: 'live_app_url',
  watchSourceId: 'watch_source_id',
  metadata: 'metadata',
};

export interface UpdateBuildPatch {
  status?: string;
  builderRef?: string | null;
  substrate?: string | null;
  specPrompt?: string | null;
  specArtifactId?: string | null;
  previewUrl?: string | null;
  liveAppUrl?: string | null;
  watchSourceId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function updateBuild(buildId: string, patch: UpdateBuildPatch): Promise<MvpBuild | undefined> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value !== undefined) {
      sets.push(`${col} = ?`);
      params.push(value);
    }
  }
  if (sets.length === 0) return getBuild(buildId);
  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(buildId);
  const rows = await run(
    `UPDATE mvp_builds SET ${sets.join(', ')} WHERE id = ? RETURNING *`,
    ...params,
  );
  return rows[0] as unknown as MvpBuild | undefined;
}

/** Mark every other build for the project as superseded (after a new iteration lands). */
export async function supersedeOtherBuilds(projectId: string, keepBuildId: string): Promise<void> {
  await run(
    `UPDATE mvp_builds SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
       WHERE project_id = ? AND id != ? AND status != 'superseded'`,
    projectId,
    keepBuildId,
  );
}

export interface AddFeedbackInput {
  projectId: string;
  buildId?: string | null;
  source?: string;
  sourceRefId?: string | null;
  body: string;
  severity?: string | null;
}

export async function addFeedback(input: AddFeedbackInput): Promise<MvpBuildFeedback> {
  const id = generateId('mvpf');
  const rows = await run(
    `INSERT INTO mvp_build_feedback
       (id, project_id, build_id, source, source_ref_id, body, severity)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    id,
    input.projectId,
    input.buildId ?? null,
    input.source ?? 'founder',
    input.sourceRefId ?? null,
    input.body,
    input.severity ?? null,
  );
  return rows[0] as unknown as MvpBuildFeedback;
}

export async function listPendingFeedback(projectId: string): Promise<MvpBuildFeedback[]> {
  return query<MvpBuildFeedback>(
    `SELECT * FROM mvp_build_feedback
       WHERE project_id = ? AND incorporated_in_iteration IS NULL
       ORDER BY created_at DESC`,
    projectId,
  );
}

/** Stamp all currently-pending feedback as folded into the given iteration. */
export async function markFeedbackIncorporated(projectId: string, iteration: number): Promise<void> {
  await run(
    `UPDATE mvp_build_feedback SET incorporated_in_iteration = ?
       WHERE project_id = ? AND incorporated_in_iteration IS NULL`,
    iteration,
    projectId,
  );
}
