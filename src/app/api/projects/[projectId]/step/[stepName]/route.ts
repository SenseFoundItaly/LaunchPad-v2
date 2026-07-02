import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { json, error } from '@/lib/api-helpers';

// Maps step names to their table, JSON column structures, and the ALLOWLIST of
// writable columns. `columns` is load-bearing for security: the POST handler
// builds UPDATE/INSERT SQL from request-body keys, so without an allowlist an
// attacker could inject arbitrary SQL via a crafted column name (the keys were
// interpolated straight into the statement). Every key is now validated against
// `columns` before any SQL is built; project_id and the auto timestamps are
// managed by the handler/DB, not client-writable here.
const STEP_TABLES: Record<string, { table: string; jsonColumns: string[]; columns: string[] }> = {
  idea_canvas: {
    table: 'idea_canvas',
    jsonColumns: ['key_metrics', 'revenue_streams', 'cost_structure'],
    columns: [
      'problem', 'solution', 'target_market', 'business_model', 'competitive_advantage',
      'value_proposition', 'unfair_advantage', 'key_metrics', 'revenue_streams', 'cost_structure',
    ],
  },
  scores: {
    table: 'scores',
    jsonColumns: ['dimensions'],
    columns: ['overall_score', 'dimensions', 'benchmark', 'recommendation', 'sources'],
  },
  research: {
    table: 'research',
    jsonColumns: ['market_size', 'competitors', 'trends', 'case_studies', 'key_insights'],
    columns: ['market_size', 'competitors', 'trends', 'case_studies', 'key_insights', 'sources'],
  },
  simulation: {
    table: 'simulation',
    jsonColumns: ['personas', 'risk_scenarios'],
    columns: ['personas', 'risk_scenarios', 'market_reception_summary', 'investor_sentiment', 'scenario_sources'],
  },
  workflow: {
    table: 'workflow',
    jsonColumns: ['gtm_strategy', 'pitch_deck', 'financial_model', 'roadmap', 'action_items'],
    columns: ['gtm_strategy', 'pitch_deck', 'financial_model', 'roadmap', 'action_items', 'status', 'current_step'],
  },
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; stepName: string }> },
) {
  const { projectId, stepName } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const stepConfig = STEP_TABLES[stepName];
  if (!stepConfig) {return error(`Unknown step: ${stepName}`, 400);}

  const rows = await query(
    `SELECT * FROM ${stepConfig.table} WHERE project_id = ?`,
    projectId,
  );
  return json(rows.length > 0 ? rows[0] : null);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; stepName: string }> },
) {
  const { projectId, stepName } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = await request.json();
  if (!body) {return error('Request body required');}

  const stepConfig = STEP_TABLES[stepName];
  if (!stepConfig) {return error(`Unknown step: ${stepName}`, 400);}

  // SECURITY: reject any body key that is not an allowlisted column for this
  // step BEFORE building SQL. Column names cannot be parameterized, so this
  // allowlist is what prevents SQL injection via crafted keys.
  const allowed = new Set(stepConfig.columns);
  const disallowed = Object.keys(body).filter((k) => k !== 'project_id' && !allowed.has(k));
  if (disallowed.length > 0) {
    return error(`Unknown field(s) for step "${stepName}": ${disallowed.join(', ')}`, 400);
  }

  // Check if row exists
  const existing = await query(
    `SELECT project_id FROM ${stepConfig.table} WHERE project_id = ?`,
    projectId,
  );

  if (existing.length > 0) {
    // Update
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (key === 'project_id') {continue;}
      fields.push(`${key} = ?`);
      values.push(value);
    }
    if (fields.length > 0) {
      values.push(projectId);
      await run(
        `UPDATE ${stepConfig.table} SET ${fields.join(', ')} WHERE project_id = ?`,
        ...values,
      );
    }
  } else {
    // Insert
    const columns = ['project_id'];
    const placeholders = ['?'];
    const values: unknown[] = [projectId];
    for (const [key, value] of Object.entries(body)) {
      if (key === 'project_id') {continue;}
      columns.push(key);
      placeholders.push('?');
      values.push(value);
    }
    await run(
      `INSERT INTO ${stepConfig.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
      ...values,
    );
  }

  const [row] = await query(
    `SELECT * FROM ${stepConfig.table} WHERE project_id = ?`,
    projectId,
  );
  return json(row);
}
