import { NextRequest } from 'next/server';
import { v4 as uuid } from 'uuid';
import { query, run } from '@/lib/db';
import { json, error, mapProject } from '@/lib/api-helpers';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { ensureStartupRootNode } from '@/lib/knowledge/root-node';

export async function GET() {
  try {
    const { userId, orgId } = await requireUser();
    // UNION of org-owned + shared-with-me. DISTINCT guards the edge case
    // where a user somehow shares with themselves (the share row exists but
    // the org_id already matches). owner_email is LEFT JOINed so shared-
    // project tiles can render "shared by <email>" without a second fetch.
    const rows = await query(
      `SELECT DISTINCT p.*, u.email AS owner_email FROM projects p
         LEFT JOIN users u ON u.id = p.owner_user_id
         WHERE p.org_id = ?
           OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)
         ORDER BY p.created_at DESC`,
      orgId,
      userId,
    );
    return json(rows.map((r) => {
      const mapped = mapProject(r as Record<string, unknown>);
      // Derive access_kind once on the server so the home tile can render
      // the "Shared" badge without re-deriving from raw org/user ids.
      const isOwner = (r as Record<string, unknown>).org_id === orgId;
      mapped.access_kind = isOwner ? 'owner' : 'member';
      return mapped;
    }));
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message }, e.status);
    throw e;
  }
}

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message }, e.status);
    throw e;
  }

  const body = await request.json();
  if (!body?.name) {return error('Name is required');}

  const id = `proj_${uuid().slice(0, 12)}`;
  const now = new Date().toISOString();
  const locale = body.locale === 'it' ? 'it' : 'en';
  const partnerSlug = typeof body.partner_slug === 'string' ? body.partner_slug : null;

  await run(
    `INSERT INTO projects (id, name, description, status, current_step, llm_provider, partner_slug, locale, owner_user_id, org_id, created_at, updated_at)
     VALUES (?, ?, ?, 'created', 1, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    body.name,
    body.description || '',
    body.llm_provider || 'openai',
    partnerSlug,
    locale,
    user.userId,
    user.orgId,
    now,
    now,
  );

  // Seed the knowledge-graph root (node_type='your_startup'). The two edge-
  // writers (artifact-persistence + knowledge/upload) only draw "root → new
  // entity" edges `if (root)`, looking it up by project_id + this node_type —
  // without this node the graph stays permanently edge-less. ensureStartupRootNode
  // is idempotent and non-fatal (swallows its own errors), so awaiting it can't
  // break project creation.
  await ensureStartupRootNode(id);

  // No auto-seeded monitors. Ecosystem monitors and the weekly health check are
  // now created on demand from chat — the founder approves a propose_monitor
  // tool call. seedEcosystemMonitorsForProject() and the health-check template
  // are no longer wired here; if we ever expose a manual "seed defaults"
  // recovery action, add a new route and call back into the lib.
  const row = await query('SELECT * FROM projects WHERE id = ?', id);
  return json(mapProject(row[0]), 201);
}
