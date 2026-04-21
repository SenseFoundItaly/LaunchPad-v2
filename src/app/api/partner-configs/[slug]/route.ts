import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import type { PartnerConfig } from '@/types';

/**
 * GET /api/partner-configs/{slug}
 *
 * Public endpoint (read-only). Returns the partner branding + defaults so
 * the /onboard/{slug} page can render without the founder being logged in.
 * Phase 0 scope: no auth required to read; write/delete routes come Phase 1
 * when a DB-driven partner admin UI is added.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const rows = query<Record<string, unknown>>(
    'SELECT slug, display_name, locale, knowledge_seed, preferred_skills, brief_template, brand, created_at FROM partner_configs WHERE slug = ?',
    slug,
  );
  if (rows.length === 0) {
    // Graceful empty response for unknown partners — the onboarding page
    // renders a generic fallback so URL typos don't crash the user flow.
    return json(null, 404);
  }

  const row = rows[0];
  const config: PartnerConfig = {
    slug: row.slug as string,
    display_name: row.display_name as string,
    locale: (row.locale as string) || 'en',
    knowledge_seed: safeJson(row.knowledge_seed),
    preferred_skills: safeJson(row.preferred_skills),
    brief_template: (row.brief_template as string) || 'default',
    brand: safeJson(row.brand),
    created_at: row.created_at as string,
  };
  return json(config);
}

function safeJson<T>(v: unknown): T | null {
  if (!v) return null;
  if (typeof v !== 'string') return v as T;
  try { return JSON.parse(v) as T; } catch { return null; }
}
