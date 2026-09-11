import { NextRequest } from 'next/server';
import { v4 as uuid } from 'uuid';
import { run, get } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

interface DraftRow {
  id: string;
  project_id: string;
  name: string;
  draft_type: string;
  current_version: number;
}

interface VersionRow {
  id: string;
  rendered_html: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await params;
  const body = await request.json();
  const { slug, metadata = {} } = body;

  if (!slug) return error('slug is required');

  const draft = get<DraftRow>('SELECT * FROM drafts WHERE id = ?', draftId);
  if (!draft) return error('Draft not found', 404);

  const version = get<VersionRow>(
    'SELECT * FROM draft_versions WHERE draft_id = ? AND version_number = ?',
    draftId,
    draft.current_version,
  );
  if (!version) return error('Version not found', 404);
  if (!version.rendered_html) return error('No rendered HTML available for this version', 400);

  // Check slug uniqueness
  const existing = get('SELECT id FROM published_assets WHERE slug = ? AND is_active = 1', slug);
  if (existing) return error('Slug already in use', 409);

  const assetId = `pub_${uuid().slice(0, 12)}`;
  run(
    `INSERT INTO published_assets (id, project_id, draft_id, draft_version_id, asset_type, slug, metadata, is_active, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
    assetId,
    draft.project_id,
    draftId,
    version.id,
    draft.draft_type,
    slug,
    JSON.stringify(metadata),
  );

  run(
    `UPDATE drafts SET status = 'published', published_url = ?, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    `/published/${slug}`,
    draftId,
  );

  return json({
    asset_id: assetId,
    slug,
    url: `/published/${slug}`,
  });
}
