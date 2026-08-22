import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { readNorthStar, readPromoted, readSections } from '@/lib/kickoff/store';
import { query } from '@/lib/db';
import { KICKOFF_STEP } from '@/lib/kickoff/prompt';
import { kickoffProgress, PILLARS } from '@/lib/kickoff/pillars';
import { auditSummary, SECTIONS } from '@/lib/kickoff/sections';

/**
 * GET /api/lite/{projectId}/north-star
 *
 * The five pillars plus derived progress, for the panel beside the chat.
 *
 * Progress is computed here rather than stored, so the bar cannot disagree with
 * the document it describes — see `kickoffProgress`.
 *
 * Authorised through `tryProjectAccess` like every other project-scoped route.
 * The lite surface is isolated from the main app in every other respect, but it
 * is NOT isolated from authorisation: a workspace UUID must never be enough to
 * read someone's plan (that is the mistake the competitor teardown flagged).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const [pillars, promoted, sections, turns, proj] = await Promise.all([
    readNorthStar(projectId),
    readPromoted(projectId),
    readSections(projectId),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM chat_messages
        WHERE project_id = ? AND step = ? AND role = 'user'`,
      projectId, KICKOFF_STEP,
    ).catch(() => [{ n: 0 }]),
    query<{ locale: string | null }>('SELECT locale FROM projects WHERE id = ?', projectId)
      .catch(() => [] as { locale: string | null }[]),
  ]);

  // In-project UI locale comes from the PROJECT, never the account (CLAUDE.md).
  // Without this the panel rendered English headings beside an Italian
  // conversation — the labels existed and were simply never sent.
  const locale = proj[0]?.locale === 'it' ? 'it' : 'en';

  return json({
    locale,
    pillars: PILLARS.map((p) => ({
      id: p.id,
      label: p.label,
      labelIt: p.labelIt,
      source: p.source,
      value: pillars[p.id] ?? null,
      promotedAt: promoted[p.id] ?? null,
      promotesTo: p.promotesTo,
    })),
    sections: SECTIONS.map((s) => ({
      id: s.id,
      label: s.label,
      labelIt: s.labelIt,
      blurb: s.blurb,
      blurbIt: s.blurbIt,
      promotesTo: s.promotesTo ?? null,
      ...(sections[s.id]
        ? { text: sections[s.id].text, risk: sections[s.id].risk, confidence: sections[s.id].confidence }
        : { text: null, risk: '', confidence: null }),
    })),
    audit: auditSummary(sections),
    progress: kickoffProgress(pillars, turns[0]?.n ?? 0),
  });
}
