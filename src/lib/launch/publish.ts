/**
 * publishLandingPage — the launch pipeline's page-publish orchestration.
 * Gate → load HTML from the generated artifact → driver publish → record a
 * REAL published_assets row (url + host_ref) → hook the URL into monitoring.
 *
 * Founder-gated at every entry: the direct API route is a founder click, the
 * publish_landing_page executor runs only on Inbox Apply. Stage-5's
 * something_shipped check counts published_assets rows, so a publish greens
 * the spine organically — no check changes needed.
 *
 * Republish semantics: one published_assets row per source artifact. A second
 * publish of the same artifact redeploys to the SAME site (host_ref) and
 * updates the row in place — iterating on copy never burns a new URL.
 *
 * sourceBuildId (record a live MVP build without re-hosting) is deliberately
 * deferred to PR-D: mvp_builds ships in PR #218 which is not merged yet.
 */

import { query, run, get } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { recordEvent } from '@/lib/memory/events';
import { assertLaunchAllowed } from './launch-gate';
import { getActivePublisher } from './publishers';
import { ensureAssetWatch } from './asset-watch';

export interface PublishLandingPageInput {
  projectId: string;
  /** build_artifacts row with artifact_type='html-preview' (content = raw HTML). */
  sourceArtifactId: string;
  slug?: string;
}

export interface PublishedAssetRow {
  id: string;
  slug: string;
  url: string | null;
  host_ref: string | null;
  publisher: string | null;
  source_artifact_id: string | null;
  watch_source_id: string | null;
  asset_type: string;
  published_at: string;
  metadata: Record<string, unknown> | null;
}

/** Netlify Forms rider: mark the page's forms for server-side capture. The
 *  build-landing-page skill emits the attribute natively going forward; this
 *  rewrite is the safety net for artifacts generated before that. Only forms
 *  without an explicit action are Netlify-capturable. */
export function markFormsForNetlify(html: string): string {
  return html.replace(/<form(?![^>]*data-netlify)(?![^>]*\baction=)([^>]*)>/gi, (m, attrs) => {
    const named = /\bname=/i.test(attrs) ? attrs : `${attrs} name="signup"`;
    return `<form data-netlify="true"${named}>`;
  });
}

function slugify(seed: string): string {
  return seed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'page';
}

export async function publishLandingPage(input: PublishLandingPageInput): Promise<{ assetId: string; url: string }> {
  const { projectId, sourceArtifactId } = input;
  await assertLaunchAllowed(projectId);

  const artifact = await get<{ id: string; title: string | null; content: string | null; artifact_type: string }>(
    `SELECT id, title, content, artifact_type FROM build_artifacts WHERE id = ? AND project_id = ?`,
    sourceArtifactId, projectId,
  );
  if (!artifact) throw new Error('LAUNCH_NOT_FOUND: artifact not found in this project.');
  if (artifact.artifact_type !== 'html-preview' || !artifact.content?.trim()) {
    throw new Error('LAUNCH_UNSUPPORTED: only html-preview artifacts with content can be published.');
  }

  const html = markFormsForNetlify(artifact.content);
  const prior = await get<{ id: string; slug: string; host_ref: string | null }>(
    `SELECT id, slug, host_ref FROM published_assets WHERE project_id = ? AND source_artifact_id = ? LIMIT 1`,
    projectId, sourceArtifactId,
  );

  const slug = prior?.slug ?? `${slugify(input.slug || artifact.title || 'landing-page')}-${generateId('x').slice(-6)}`;
  const result = await getActivePublisher().publish({
    projectId,
    slug: slugify(input.slug || artifact.title || 'landing-page'),
    html,
    existingHostRef: prior?.host_ref ?? undefined,
  });
  if (result.status !== 'live') {
    throw new Error(`LAUNCH_FAILED: ${result.error ?? 'publisher returned failed'}`);
  }

  const publisherId = getActivePublisher().id;
  let assetId: string;
  if (prior) {
    assetId = prior.id;
    await run(
      `UPDATE published_assets
          SET url = ?, host_ref = ?, publisher = ?, is_active = true, published_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      result.url, result.hostRef, publisherId, assetId,
    );
  } else {
    assetId = generateId('pa');
    await run(
      `INSERT INTO published_assets
         (id, project_id, asset_type, slug, url, host_ref, publisher, source_artifact_id, metadata, is_active, published_at)
       VALUES (?, ?, 'landing_page', ?, ?, ?, ?, ?, ?, true, CURRENT_TIMESTAMP)`,
      assetId, projectId, slug, result.url, result.hostRef, publisherId, sourceArtifactId,
      { title: artifact.title ?? 'Landing page', source: 'launch_publish', form_name: 'signup' },
    );
  }

  const watchId = await ensureAssetWatch(projectId, result.url, `Live: ${artifact.title ?? slug}`);
  if (watchId) {
    await run(`UPDATE published_assets SET watch_source_id = ? WHERE id = ?`, watchId, assetId)
      .catch(() => {});
  }

  try {
    const owner = await get<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?', projectId,
    );
    if (owner?.owner_user_id) {
      await recordEvent({
        userId: owner.owner_user_id,
        projectId,
        eventType: 'asset_published',
        payload: { asset_id: assetId, url: result.url, publisher: publisherId, source_artifact_id: sourceArtifactId },
      });
    }
  } catch { /* trace only — never a publish blocker */ }

  return { assetId, url: result.url };
}

/** Published assets for the launch surfaces (HtmlPreviewCard pill, Data Room,
 *  future LaunchPanel). Newest first. */
export async function listPublishedAssets(projectId: string): Promise<PublishedAssetRow[]> {
  return query<PublishedAssetRow>(
    `SELECT id, slug, url, host_ref, publisher, source_artifact_id, watch_source_id,
            asset_type, published_at, metadata
       FROM published_assets
      WHERE project_id = ? AND is_active = true
      ORDER BY published_at DESC`,
    projectId,
  );
}
