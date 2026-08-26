import { NextRequest } from 'next/server';
import { error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { query } from '@/lib/db';
import { runAgentStream } from '@/lib/pi-agent';
import { readNorthStar, readSections, makeSectionTool } from '@/lib/kickoff/store';
import { auditPrompt, AUDIT_STEP } from '@/lib/kickoff/audit-prompt';
import { KICKOFF_STEP } from '@/lib/kickoff/prompt';
import { auditSummary, SECTION_IDS } from '@/lib/kickoff/sections';
import { recordAgentUsage, isProjectCapped } from '@/lib/cost-meter';

/**
 * POST /api/lite/{projectId}/audit — fill all seven sections in one pass.
 *
 * This is the payload of the lite product. The kickoff interview is the part
 * the founder does; this is the part that makes doing it worth it — one or two
 * answers in, seven sections come back filled, each carrying the risk that
 * would make it wrong.
 *
 * Runs on its OWN step (`kickoff:audit`), not the interview's. Two reasons:
 *   - the audit is a single stateless pass; it must not accumulate history, and
 *     appending seven tool calls to the interview thread would poison the next
 *     question with its own output
 *   - pi-agent's session is keyed per (user, project, step) — sharing a step
 *     would bleed the two conversations together (see CLAUDE.md)
 *
 * Streams, so sections land one at a time. `{ section_written: id }` after each
 * tool call is what turns a 40-second wait into a document visibly writing
 * itself — the same reason the kickoff route streams.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const project = (await query<{ name: string; description: string | null; locale: string | null }>(
    'SELECT name, description, locale FROM projects WHERE id = ?',
    projectId,
  ))[0];
  if (!project) return error('Project not found', 404);

  // The audit is the single most expensive call in the lite flow (~7 tool calls
  // in one pass). It must respect the project spend cap like everything else —
  // an uncapped path is how a runaway loop turns into a bill.
  const cap = await isProjectCapped(projectId);
  if (cap?.capped) return error('This project has reached its spending cap.', 402);

  const body = await request.json().catch(() => ({}));
  const force = body?.force === true;

  // Idempotency guards on STATE, never on history (CLAUDE.md — a permanent
  // "already ran" marker on a required step bricks it forever). If the sections
  // are already there we skip; if the founder asks again, `force` re-runs.
  const existing = await readSections(projectId);
  if (!force && auditSummary(existing).complete) {
    return new Response(
      `data: ${JSON.stringify({ skipped: 'already_complete' })}\n\ndata: ${JSON.stringify({ audit: auditSummary(existing) })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' } },
    );
  }

  const [ns, history] = await Promise.all([
    readNorthStar(projectId),
    query<{ role: string; content: string }>(
      `SELECT role, content FROM chat_messages
        WHERE project_id = ? AND step = ? ORDER BY "timestamp" ASC LIMIT 20`,
      projectId, KICKOFF_STEP,
    ).catch(() => [] as { role: string; content: string }[]),
  ]);

  const transcript = history
    .map((m) => `${m.role === 'user' ? 'Founder' : 'You'}: ${m.content}`)
    .join('\n\n');

  // Resume, don't restart. `force` (the Redraft button) rewrites everything;
  // an automatic run only fills the gaps a previous attempt left behind.
  const missing = force ? undefined : SECTION_IDS.filter((id) => !existing[id]);

  const locale = project.locale === 'it' ? 'it' : 'en';
  const systemPrompt = auditPrompt(ns, locale, {
    name: project.name,
    description: project.description,
    transcript,
  }, missing);

  const { stream, cleanup } = runAgentStream('Audit this idea and write all seven sections now.', {
    systemPrompt,
    task: 'chat',
    projectId,
    step: AUDIT_STEP,
    userId: auth.session.userId,
    tools: false,
    extraTools: [makeSectionTool(projectId)],
    // Seven sections, plus headroom for a retry on a malformed call. Not more:
    // an unbounded budget here is how a stuck model burns a founder's credit.
    maxToolCalls: 10,
  });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const userId = auth.session.userId;

  const out = new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let buffer = '';
      // WHICH section a tool call wrote is only knowable from `tool_start`:
      // pi-agent's `tool_end` frame carries { id, name, error } and nothing
      // else — no args, no result. So remember the id → section mapping on the
      // way in and resolve it on the way out.
      const pending = new Map<string, string>();
      // runAgentStream RETURNS usage on its `done` frame but logs nothing —
      // metering is the caller's job (cost-meter.ts). Without this the lite
      // flow spends real money invisibly: no llm_usage_logs row, nothing for
      // isProjectCapped to count, no line on any cost screen.
      let usage: unknown;
      let langfuseTraceId: string | null = null;
      const startedAt = Date.now();

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Trailing partial frame stays buffered — a JSON object split across
          // two chunks must not be parsed as if complete.
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.tool_start?.name === 'write_section' && ev.tool_start?.id) {
                const section = ev.tool_start?.args?.section;
                if (typeof section === 'string') pending.set(ev.tool_start.id, section);
              }
              if (ev.tool_end?.name === 'write_section' && !ev.tool_end?.error) {
                const section = pending.get(ev.tool_end.id);
                pending.delete(ev.tool_end.id);
                // Fire even without a resolved id: the client refetches the
                // whole document, so a nameless nudge still paints correctly.
                send({ section_written: section ?? true });
              }
              if (ev.done) {
                usage = ev.usage;
                langfuseTraceId = ev.langfuseTraceId ?? null;
              }
            } catch { /* incomplete frame */ }
          }
        }
        send({ audit: auditSummary(await readSections(projectId)) });
      } catch (err) {
        console.warn('[lite/audit] stream failed:', (err as Error).message);
        send({ error: 'The audit stopped early — the sections it did finish are saved.' });
      } finally {
        // Meter even when the run died mid-way: a truncated pass still burned
        // the tokens it burned, and a crash that silently escapes accounting is
        // exactly how spend goes missing.
        await recordAgentUsage({
          project_id: projectId,
          step: AUDIT_STEP,
          task: 'chat',
          usage: usage as never,
          latency_ms: Date.now() - startedAt,
          userId,
          langfuseTraceId,
          // Logged, not billed. The founder pays per chat message; the audit is
          // work the product chose to do for them, like every skill run.
          skip_credit_debit: true,
        }).catch((e) => console.warn('[lite/audit] usage not recorded:', (e as Error).message));
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
