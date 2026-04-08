import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  const roundRows = await query('SELECT * FROM fundraising_rounds WHERE project_id = ?', projectId);
  const investors = await query('SELECT * FROM investors WHERE project_id = ? ORDER BY created_at', projectId);

  // Attach interactions to each investor
  for (const inv of investors) {
    inv.interactions = await query(
      'SELECT * FROM investor_interactions WHERE investor_id = ? ORDER BY date',
      inv.id,
    );
  }

  const pitchVersions = await query(
    'SELECT * FROM pitch_versions WHERE project_id = ? ORDER BY created_at',
    projectId,
  );
  const termSheets = await query(
    'SELECT * FROM term_sheets WHERE project_id = ? ORDER BY received_at',
    projectId,
  );

  return json({
    round: roundRows.length > 0 ? roundRows[0] : null,
    investors,
    pitch_versions: pitchVersions,
    term_sheets: termSheets,
  });
}
