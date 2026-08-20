import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { runAgent } from '@/lib/pi-agent';
import { readNorthStar, makeNorthStarTool } from '@/lib/kickoff/store';
import { kickoffPrompt, KICKOFF_STEP } from '@/lib/kickoff/prompt';
import { kickoffProgress } from '@/lib/kickoff/pillars';

/**
 * POST /api/lite/{projectId}/kickoff — one turn of the lite kickoff interview.
 *
 * Deliberately NOT the main chat route. That route carries ~88k of system
 * prompt: artifact contracts, journey rules, gate state, watchers, memory,
 * skills. None of it belongs in a three-question interview, and importing it
 * would make the lite flow inherit every constraint the lite flow exists to
 * shed. This route builds its own small prompt and passes exactly ONE tool.
 *
 * The isolation is the feature:
 *   - own step (`kickoff`) on the shared chat_messages table, so history works
 *     with no schema change and no coupling
 *   - own prompt (`kickoff/prompt.ts`)
 *   - one tool (`write_north_star`), which writes a draft document, never
 *     evidence — see `kickoff/store.ts` for why that is safe
 *
 * Non-streaming for now: the interview is three short turns, and a plain JSON
 * reply keeps the client trivial. Streaming is a later upgrade to this route
 * alone.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const message = typeof body?.message === 'string' ? body.message.trim() : '';

  const project = (await query<{ name: string; description: string | null; locale: string | null }>(
    'SELECT name, description, locale FROM projects WHERE id = ?',
    projectId,
  ))[0];
  if (!project) return error('Project not found', 404);

  // Prior turns of THIS interview only — the lite flow never reads the main
  // co-pilot thread, and vice versa.
  const history = await query<{ role: string; content: string }>(
    `SELECT role, content FROM chat_messages
      WHERE project_id = ? AND step = ? ORDER BY "timestamp" ASC LIMIT 40`,
    projectId,
    KICKOFF_STEP,
  ).catch(() => [] as { role: string; content: string }[]);

  const now = new Date().toISOString();
  if (message) {
    await run(
      `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
       VALUES (?, ?, ?, 'user', ?, ?, ?)`,
      generateId('msg'), projectId, KICKOFF_STEP, message.slice(0, 4000), now, auth.session.userId,
    );
  }

  // Progress is read BEFORE the turn: it decides which question to ask.
  const before = await readNorthStar(projectId);
  // Founder replies so far, INCLUDING the one just stored — the question to ask
  // is driven by the conversation, not by how much the document already knows.
  const priorFounderTurns = history.filter((m) => m.role === 'user').length + (message ? 1 : 0);
  const { currentQuestion } = kickoffProgress(before, priorFounderTurns - (message ? 1 : 0));

  const locale = project.locale === 'it' ? 'it' : 'en';
  const systemPrompt = [
    `You are the founder's co-pilot on their new venture, "${project.name}".`,
    project.description ? `Their idea, in their words: ${project.description}` : '',
    locale === 'it' ? 'Reply in Italian — the founder works in Italian.' : 'Reply in English.',
    '',
    kickoffPrompt(KICKOFF_STEP, before, currentQuestion),
  ].filter(Boolean).join('\n');

  const transcript = history
    .map((m) => `${m.role === 'user' ? 'Founder' : 'You'}: ${m.content}`)
    .join('\n\n');
  const prompt = message
    ? `${transcript ? transcript + '\n\n' : ''}Founder: ${message}`
    : transcript || '(The founder has just arrived. Open the interview.)';

  let text = '';
  try {
    const res = await runAgent(prompt, {
      systemPrompt,
      task: 'chat',
      projectId,
      step: KICKOFF_STEP,
      userId: auth.session.userId,
      // No web_search / read_url: this is an interview, not research.
      tools: false,
      extraTools: [makeNorthStarTool(projectId)],
      maxToolCalls: 6,
    });
    text = String(res?.text ?? '').trim();
  } catch (err) {
    console.warn('[lite/kickoff] agent failed:', (err as Error).message);
    return error('The co-pilot could not reply just now — try again.', 502);
  }

  if (text) {
    await run(
      `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
       VALUES (?, ?, ?, 'assistant', ?, ?, ?)`,
      generateId('msg'), projectId, KICKOFF_STEP, text, new Date().toISOString(), auth.session.userId,
    );
  }

  // Re-read AFTER the turn: the agent may have written pillars mid-reply, and
  // the client needs the post-turn progress to move its bar.
  const after = await readNorthStar(projectId);
  return json({ reply: text, progress: kickoffProgress(after, priorFounderTurns) });
}

/** GET — the interview transcript, for a resumable thread. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const messages = await query<{ id: string; role: string; content: string; timestamp: string }>(
    `SELECT id, role, content, "timestamp" FROM chat_messages
      WHERE project_id = ? AND step = ? ORDER BY "timestamp" ASC LIMIT 60`,
    projectId,
    KICKOFF_STEP,
  ).catch(() => []);

  const ns = await readNorthStar(projectId);
  return json({
    messages,
    progress: kickoffProgress(ns, messages.filter((m) => m.role === 'user').length),
  });
}
