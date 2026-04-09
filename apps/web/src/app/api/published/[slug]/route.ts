import { NextRequest } from 'next/server';
import { get } from '@/lib/db';

interface AssetRow {
  id: string;
  draft_version_id: string;
  metadata: string;
}

interface VersionRow {
  rendered_html: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const asset = get<AssetRow>(
    'SELECT * FROM published_assets WHERE slug = ? AND is_active = 1',
    slug,
  );
  if (!asset) {
    return new Response('Not Found', { status: 404 });
  }

  const version = get<VersionRow>(
    'SELECT rendered_html FROM draft_versions WHERE id = ?',
    asset.draft_version_id,
  );
  if (!version?.rendered_html) {
    return new Response('Content not available', { status: 404 });
  }

  return new Response(version.rendered_html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
