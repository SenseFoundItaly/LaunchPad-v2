import { NextRequest } from 'next/server';
import { v4 as uuid } from 'uuid';
import { query, run } from '@/lib/db';
import { json, error, mapProject } from '@/lib/api-helpers';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { ensureStartupRootNode } from '@/lib/knowledge/root-node';
import { seedIdeaCanvasFromDescription } from '@/lib/idea-canvas-seed';
import { isLocale } from '@/lib/i18n/locales';
import { resolveLocale } from '@/lib/i18n/resolve-locale';

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
  // The project is "created in" a language and then frozen there. An explicit
  // body.locale (onboarding / white-label partner) wins; otherwise inherit the
  // creator's account-wide language (users.locale → 'en').
  const locale = isLocale(body.locale) ? body.locale : await resolveLocale(user.userId, null);
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

  // No preset watchers are seeded on create (17/06 product decision: the 3
  // defaults were removed). Founders create their own from the Watchers tab, or
  // the co-pilot proposes them at Stage 2 (chat/route.ts) — onboarding teaches
  // how. `seedEcosystemMonitorsForProject` stays available for an explicit
  // "add recommended watchers" gesture if we reintroduce one.

  // Seed a PENDING Idea Canvas proposal from the founder's description so Stage 0
  // has a one-click "approve your canvas" card waiting — WITHOUT depending on the
  // chat agent to emit the canvas on turn 1 (unreliable: Italian founder sim
  // 2026-06-30 left the canvas null after turn 1). Gate-respecting (proposes
  // only) + never throws (mirrors ensureStartupRootNode), so it cannot break
  // creation. Awaited (not fire-and-forget) because serverless may kill detached
  // work after the response; a one-shot Sonnet extraction is ~1-2s.
  await seedIdeaCanvasFromDescription({
    projectId: id,
    name: body.name,
    description: body.description || '',
    locale,
  }).catch(() => {});

  const row = await query('SELECT * FROM projects WHERE id = ?', id);
  return json(mapProject(row[0]), 201);
}
