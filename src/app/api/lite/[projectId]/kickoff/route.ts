import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { runAgentStream } from '@/lib/pi-agent';
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
 * STREAMS (SSE). Not for latency theatre: the `tool_end` frame for
 * `write_north_star` is what lets the panel fill WHILE Otto is still talking.
 * Waiting for the turn to finish would collapse the one moment the whole flow
 * exists to produce — watching the document write itself.
 *
 * Frames, on top of the agent's own ({content}, {tool_start}, {tool_end}):
 *   { pillar_written: "01" }   — refresh the panel now
 *   { progress: {...} }        — final, after the reply is persisted
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

  const { stream, cleanup } = runAgentStream(prompt, {
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

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const userId = auth.session.userId;

  const out = new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let fullText = '';
      let buffer = '';

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);                 // pass the agent's frames through

          // Accumulate the reply for persistence, and watch for pillar writes.
          // Partial frames are kept in `buffer` — a JSON object split across
          // two chunks would otherwise be silently dropped.
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (typeof ev.content === 'string') fullText += ev.content;
              // The moment that makes the panel feel alive.
              if (ev.tool_end?.name === 'write_north_star') send({ pillar_written: true });
            } catch { /* not a complete JSON frame — ignore */ }
          }
        }

        const text = fullText.trim();
        if (text) {
          await run(
            `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
             VALUES (?, ?, ?, 'assistant', ?, ?, ?)`,
            generateId('msg'), projectId, KICKOFF_STEP, text, new Date().toISOString(), userId,
          );
        }
        // Final frame: progress AFTER the turn, so the bar moves once the
        // pillars this turn wrote are actually on disk.
        const after = await readNorthStar(projectId);
        send({ progress: kickoffProgress(after, priorFounderTurns) });
      } catch (err) {
        console.warn('[lite/kickoff] stream failed:', (err as Error).message);
        send({ error: 'The co-pilot stopped mid-reply — try again.' });
      } finally {
        cleanup();
        controller.close();
      }
    },
  });

  return new Response(out, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
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
