import { NextRequest } from 'next/server';
import { v4 as uuid } from 'uuid';
import { query, run } from '@/lib/db';
import { json, error, mapProject, generateId } from '@/lib/api-helpers';
import { seedEcosystemMonitorsForProject } from '@/lib/ecosystem-monitors';

export async function GET() {
  const rows = query('SELECT * FROM projects ORDER BY created_at DESC');
  return json(rows.map(mapProject));
}

/**
 * Seeds the `health` operational monitor (not covered by ecosystem.* monitors).
 *
 * History: PR #7 originally seeded 3 monitors (health, competitor, market).
 * The `competitor` and `market` monitors were dropped here because the
 * structured `ecosystem.competitors` and `ecosystem.trends` monitors in
 * src/lib/ecosystem-monitors.ts supersede them — they emit
 * :::artifact{type=ecosystem_alert} blocks that populate ecosystem_alerts,
 * whereas the old monitors only wrote free-text to the generic alerts table.
 * `health` stays because it is an internal-metrics check, not an ecosystem
 * scan — different semantics, different target surface.
 */
function createHealthMonitor(projectId: string, projectName: string) {
  const id = generateId('mon');
  const now = new Date().toISOString();
  run(
    `INSERT INTO monitors (id, project_id, type, name, schedule, prompt, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    id,
    projectId,
    'health',
    'Weekly Health Check',
    'weekly',
    `Analyze the current state of project "${projectName}". Check metrics, burn rate, growth trajectory, and flag any concerns. Provide a brief health summary.`,
    now,
  );
  return { monitor_id: id, type: 'health', name: 'Weekly Health Check' };
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body?.name) {return error('Name is required');}

  const id = `proj_${uuid().slice(0, 12)}`;
  const now = new Date().toISOString();
  const locale = body.locale === 'it' ? 'it' : 'en';
  const partnerSlug = typeof body.partner_slug === 'string' ? body.partner_slug : null;

  run(
    `INSERT INTO projects (id, name, description, status, current_step, llm_provider, partner_slug, locale, created_at, updated_at)
     VALUES (?, ?, ?, 'created', 1, ?, ?, ?, ?, ?)`,
    id,
    body.name,
    body.description || '',
    body.llm_provider || 'openai',
    partnerSlug,
    locale,
    now,
    now,
  );

  // Seed the operational `health` monitor + the 4 Layer-1 ecosystem monitors.
  // Non-fatal if either fails — the project must still be created so the
  // founder can recover manually via the dashboard.
  let healthSeed: { monitor_id: string; type: string; name: string } | null = null;
  let ecosystemSeed: { created: unknown[]; skipped: unknown[]; error?: string } = { created: [], skipped: [] };

  try {
    healthSeed = createHealthMonitor(id, body.name);
  } catch (err) {
    console.warn('Health monitor seed failed:', (err as Error).message);
  }

  try {
    ecosystemSeed = seedEcosystemMonitorsForProject(id);
  } catch (err) {
    ecosystemSeed = { created: [], skipped: [], error: (err as Error).message };
  }

  const row = query('SELECT * FROM projects WHERE id = ?', id);
  return json({
    ...mapProject(row[0]),
    monitors_seeded: {
      health: healthSeed,
      ecosystem: ecosystemSeed,
    },
  }, 201);
}
