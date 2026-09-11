import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

// Maps step names to their table and JSON column structures
const STEP_TABLES: Record<string, { table: string; jsonColumns: string[] }> = {
  idea_canvas: {
    table: 'idea_canvas',
    jsonColumns: ['key_metrics', 'revenue_streams', 'cost_structure'],
  },
  scores: {
    table: 'scores',
    jsonColumns: ['dimensions'],
  },
  research: {
    table: 'research',
    jsonColumns: ['market_size', 'competitors', 'trends', 'case_studies', 'key_insights'],
  },
  simulation: {
    table: 'simulation',
    jsonColumns: ['personas', 'risk_scenarios'],
  },
  workflow: {
    table: 'workflow',
    jsonColumns: ['gtm_strategy', 'pitch_deck', 'financial_model', 'roadmap', 'action_items'],
  },
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; stepName: string }> },
) {
  const { projectId, stepName } = await params;
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
  const body = await request.json();
  if (!body) {return error('Request body required');}

  const stepConfig = STEP_TABLES[stepName];
  if (!stepConfig) {return error(`Unknown step: ${stepName}`, 400);}

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
      values.push(stepConfig.jsonColumns.includes(key) ? JSON.stringify(value) : value);
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
      values.push(stepConfig.jsonColumns.includes(key) ? JSON.stringify(value) : value);
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
