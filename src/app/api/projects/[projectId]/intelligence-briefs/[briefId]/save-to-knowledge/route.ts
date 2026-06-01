import { NextRequest } from 'next/server';
import { get } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { recordFact } from '@/lib/memory/facts';

interface BriefRow {
  id: string;
  project_id: string;
  title: string;
  narrative: string;
  entity_name: string | null;
  confidence: number;
}

function buildFactText(brief: BriefRow): string {
  const head = brief.entity_name ? `${brief.entity_name} — ${brief.title}` : brief.title;
  const body = brief.narrative.length > 250
    ? `${brief.narrative.slice(0, 250)}…`
    : brief.narrative;
  return `${head}. ${body}`;
}

/**
 * POST /api/projects/{projectId}/intelligence-briefs/{briefId}/save-to-knowledge
 *
 * Founder confirmation that a synthesized brief is worth preserving in the
 * project's durable knowledge layer. Reads the brief, builds a fact text
 * grounded in title + narrative, and records it as an applied observation
 * attributed back to the brief.
 *
 * Idempotent: recordFact dedups on (user, project, kind, fact text) within
 * non-rejected rows, so re-clicking the button bumps confidence on the
 * existing fact rather than inserting a duplicate.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; briefId: string }> },
) {
  const { projectId, briefId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const { userId } = auth.session;

  const brief = await get<BriefRow>(
    `SELECT id, project_id, title, narrative, entity_name, confidence
     FROM intelligence_briefs
     WHERE id = ?`,
    briefId,
  );

  if (!brief) return error('Brief not found', 404);
  if (brief.project_id !== projectId) return error('Brief does not belong to this project', 403);

  const factText = buildFactText(brief);

  const factId = await recordFact({
    userId,
    projectId,
    fact: factText,
    kind: 'observation',
    sourceType: 'monitor',
    sourceId: briefId,
    confidence: brief.confidence,
    initialState: 'applied',
  });

  if (!factId) return error('Failed to record fact', 500);

  return json({ fact_id: factId });
}
