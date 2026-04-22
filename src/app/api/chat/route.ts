import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { chatStream } from '@/lib/llm';
import { STEP_SYSTEM_PROMPTS } from '@/lib/llm/prompts';
import { logUsageToSQLite, logToLangfuse } from '@/lib/telemetry';
import { runAgentStream } from '@/lib/pi-agent';
import { buildSystemPromptString, resolveProjectLocale } from '@/lib/agent-prompt';
import { makeProjectTools } from '@/lib/project-tools';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { buildMemoryContext } from '@/lib/memory/context';
import { recordEvent } from '@/lib/memory/events';
import { recordFact } from '@/lib/memory/facts';
import { parseMessageContent } from '@/lib/artifact-parser';
import type { FactArtifact, WorkflowCard } from '@/types/artifacts';
import { isProjectCapped } from '@/lib/cost-meter';
import { getSkillTools } from '@/lib/skill-tools';
import { captureWorkflow } from '@/lib/workflow-capture';
import { pickModel } from '@/lib/llm/router';

// Artifact instructions prepended to every message
const ARTIFACT_INSTRUCTIONS = `[You are LaunchPad, a proactive startup advisor. MANDATORY: Use :::artifact{} blocks to render rich cards and charts. NEVER use emojis in any text output — no unicode emoji characters anywhere in your responses. Use plain text only.

CARD ARTIFACTS:
entity-card: :::artifact{"type":"entity-card","id":"ent_ID"}\n{"name":"X","entity_type":"competitor","summary":"...","attributes":{}}\n:::
option-set: :::artifact{"type":"option-set","id":"opt_ID"}\n{"prompt":"?","options":[{"id":"a","label":"A","description":"..."}]}\n:::
insight-card: :::artifact{"type":"insight-card","id":"ins_ID"}\n{"category":"market","title":"...","body":"...","confidence":"high"}\n:::
action-suggestion: :::artifact{"type":"action-suggestion","id":"act_ID"}\n{"title":"...","description":"...","action_label":"Go","action_type":"research"}\n:::
workflow-card: :::artifact{"type":"workflow-card","id":"wf_ID"}\n{"title":"...","category":"marketing","description":"...","priority":"high","steps":["1","2","3"]}\n:::
comparison-table: :::artifact{"type":"comparison-table","id":"cmp_ID"}\n{"title":"...","columns":["A","B"],"rows":[{"label":"Row1","values":["val1","val2"]}]}\n:::

CHART ARTIFACTS (use for scores, data, analysis):
radar-chart: :::artifact{"type":"radar-chart","id":"rdr_ID"}\n{"title":"Scoring Dimensions","data":[{"subject":"Market","value":8},{"subject":"Team","value":6}]}\n:::
bar-chart: :::artifact{"type":"bar-chart","id":"bar_ID"}\n{"title":"Revenue Breakdown","data":[{"name":"Q1","value":50000},{"name":"Q2","value":80000}]}\n:::
pie-chart: :::artifact{"type":"pie-chart","id":"pie_ID"}\n{"title":"Market Share","data":[{"name":"Us","value":30},{"name":"Competitor","value":70}]}\n:::
gauge-chart: :::artifact{"type":"gauge-chart","id":"gau_ID"}\n{"title":"Overall Score","score":7.5,"maxScore":10,"verdict":"GO"}\n:::
score-card: :::artifact{"type":"score-card","id":"sc_ID"}\n{"title":"Market Opportunity","score":8.5,"maxScore":10,"description":"Large TAM with strong tailwinds"}\n:::
metric-grid: :::artifact{"type":"metric-grid","id":"mg_ID"}\n{"title":"Key Metrics","metrics":[{"label":"MRR","value":"$12K","change":"+15%"},{"label":"CAC","value":"$200"}]}\n:::
sensitivity-slider: :::artifact{"type":"sensitivity-slider","id":"ss_ID"}\n{"title":"Revenue Sensitivity","variables":[{"name":"retainer","min":4000,"max":15000,"value":8000,"unit":"$"},{"name":"takeRate","min":5,"max":25,"value":15,"unit":"%"}],"output":{"label":"Monthly Revenue per Engagement","formula":"retainer * takeRate / 100"}}\n:::

MEMORY ARTIFACT (invisible to user; writes to long-term memory):
fact: :::artifact{"type":"fact","id":"fact_ID"}\n{"fact":"Founder committed to Bohm pilot by May 31","kind":"decision","confidence":0.9}\n:::
- kind options: fact | decision | observation | note | preference
- Use when the user states a commitment, pivots, names a new target, expresses a preference, or reveals a durable constraint. Do NOT emit a fact for small chit-chat.

RULES:
1) Use gauge-chart for overall scores with GO/NO-GO/CAUTION verdict
2) Use radar-chart when scoring across multiple dimensions (scoring, risk audit, business model)
3) Use bar-chart for comparisons and rankings
4) Use score-card for individual dimension scores
5) Use metric-grid for key numbers and KPIs
6) Use comparison-table for side-by-side model/competitor comparison
7) ALWAYS end with option-set or action-suggestion for next steps
8) entity-card for EVERY entity mentioned
9) workflow-card for concrete multi-step action plans
10) Be proactive — use tools to research, browse web, challenge assumptions

CRITICAL SYNTHESIS RULE:
- Every turn MUST end with a visible text response to the founder summarizing
  what you learned and recommending next steps. Tool calls alone are NOT a
  valid final turn — the founder needs prose.
- Budget your tool use. After 3-4 rounds of tool calls on a topic, stop
  researching and synthesize. You can always make more tool calls in a
  follow-up turn if the founder asks.
- If you find yourself wanting to call more tools, ask yourself: "Would
  the founder prefer a partial answer now, or a perfect answer that never
  arrives?" Ship the partial answer.]

`;

export async function POST(request: NextRequest) {
  // Auth gate: the chat route always runs for a real user. Memory scoping
  // requires a userId; without it we can't build per-user context or log
  // chat_turn events.
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) {
      return new Response(
        JSON.stringify({ success: false, error: e.message }),
        { status: e.status, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw e;
  }

  const body = await request.json();
  if (!body) {
    return new Response(
      JSON.stringify({ success: false, error: 'Request body required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { project_id, step = 'chat', messages = [], provider = 'openai' } = body;

  if (!project_id) {
    return new Response(
      JSON.stringify({ success: false, error: 'project_id is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const projects = query<{ id: string; name: string; description: string }>(
    'SELECT id, name, description FROM projects WHERE id = ?', project_id
  );
  if (projects.length === 0) {
    return new Response(
      JSON.stringify({ success: false, error: 'Project not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Cost-aware throttle: if this project has hit its monthly LLM cap
  // (or an admin has flipped status=capped), refuse before spending.
  // Critical safety rail because skills auto-invocation (below) can fan
  // out a single chat turn into multiple LLM calls.
  const capStatus = isProjectCapped(project_id);
  if (capStatus.capped) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'budget_exceeded',
        current_usd: capStatus.currentUsd,
        cap_usd: capStatus.capUsd,
        period_month: capStatus.periodMonth,
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const lastMessage = messages[messages.length - 1]?.content || '';
  const projectContext = `[PROJECT: "${projects[0].name}"${projects[0].description ? ` — ${projects[0].description}` : ''}]\n`;

  // Memory context — curated facts + recent events + graph summary + completed
  // skills — lets the agent remember across sessions AND across chat "steps"
  // within a project (see sessionId change below).
  const memoryContext = buildMemoryContext(userId, project_id);

  // Build system prompt: SOUL + AGENTS personality first (locale-aware),
  // then ARTIFACT_INSTRUCTIONS, then per-project context + memory + recently-
  // completed skill summaries. SOUL/AGENTS were previously missing from the
  // chat path — they're now loaded from agents/*.md (or .it.md).
  const locale = resolveProjectLocale(project_id, query);
  const skillContext = buildCompletedSkillContext(project_id, lastMessage);
  const systemPrompt = buildSystemPromptString({
    locale,
    context: 'chat',
    tail: ARTIFACT_INSTRUCTIONS,
    projectContext: `${projectContext}${memoryContext}\n${skillContext}`,
  });
  const encoder = new TextEncoder();

  // Session key: per (user, project) rather than per (project, step).
  // This unifies memory across the "chat" / "research" / "simulation" steps
  // within a single project — if the user asked about competitor X under
  // research, the agent remembers that when they switch to chat.
  const sessionId = `user-${userId}-project-${project_id}`;
  const piStart = Date.now();

  try {
    // Project-scoped tools let the chat agent answer from THIS project's data
    // (ecosystem_alerts, pending_actions, graph_nodes, metrics, idea_canvas)
    // and queue its own drafts into the approval inbox. The factory closes
    // over project_id so the agent cannot accidentally read or write another
    // project's rows.
    const projectTools = makeProjectTools(project_id);

    // Skill tools — auto-invocation enabled per plan decision. The agent
    // can decide mid-turn to invoke e.g. skill_market_research when the user
    // asks about competitors. One-level-deep (skills can't invoke skills).
    // Cost safety rail: the throttle above refuses if the project crosses
    // its monthly cap, so runaway chains cap themselves.
    const skillTools = getSkillTools({ userId, projectId: project_id });

    const { stream: piStream } = runAgentStream(lastMessage, {
      sessionId,
      systemPrompt,
      extraTools: [...projectTools, ...skillTools],
      // 300s — research-heavy chat turns (web_search + read_url + skill
      // invocation + tam/sam calculations) can legitimately take 2-3 min.
      // 120s was cutting the agent off mid-tool-loop, leaving an empty
      // final assistant message and no visible response in the UI.
      timeout: 300000,
      task: 'chat',
    });

    // Accumulate response text so we can: (1) extract agent-emitted facts via
    // :::artifact{type="fact"} blocks, (2) write a chat_turn memory_event with
    // a meaningful preview, (3) fuel later telemetry.
    let fullResponse = '';
    const decoder = new TextDecoder();

    // Wrap to add telemetry + memory hooks on completion
    const telemetryStream = piStream.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        // chunk is the raw SSE event buffer; decode + peek at JSON deltas
        try {
          const text = decoder.decode(chunk, { stream: true });
          // Look for content deltas: `data: {"content":"..."}`
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const payload = JSON.parse(line.slice(6));
                if (typeof payload.content === 'string') {
                  fullResponse += payload.content;
                }
              } catch {
                // non-JSON SSE line; ignore
              }
            }
          }
        } catch {
          // ignore decode errors; chunk still forwards
        }
        controller.enqueue(chunk);
      },
      flush() {
        const latencyMs = Date.now() - piStart;
        // Pull the actual provider+model from the router so the logged slug
        // reflects reality (direct Anthropic vs OpenRouter). Falls back to
        // PI_PROVIDER/PI_MODEL env vars for call sites without a task label.
        const picked = pickModel('chat');
        const piProvider = picked.provider;
        const piModel = picked.model;
        const usage = { output_tokens: 0 };
        logUsageToSQLite(project_id, null, step, piProvider, piModel, usage, 0, latencyMs);
        logToLangfuse(
          { projectId: project_id, step, provider: piProvider as 'anthropic' | 'openai' | 'openrouter', model: piModel },
          usage, 0, latencyMs,
          lastMessage.slice(0, 1000), '',
        );

        // Memory: chat_turn event + fact artifact extraction.
        // Wrapped in try so memory failures never break the stream response.
        try {
          recordEvent({
            userId,
            projectId: project_id,
            eventType: 'chat_turn',
            payload: {
              preview: lastMessage.slice(0, 200),
              response_preview: fullResponse.slice(0, 200),
              step,
            },
          });

          const segments = parseMessageContent(fullResponse);
          for (const seg of segments) {
            if (seg.type !== 'artifact') continue;
            if (seg.artifact.type === 'fact') {
              const f = seg.artifact as FactArtifact;
              if (f.fact && typeof f.fact === 'string') {
                recordFact({
                  userId,
                  projectId: project_id,
                  fact: f.fact,
                  kind: f.kind ?? 'fact',
                  sourceType: 'chat',
                  confidence: f.confidence ?? 0.8,
                });
              }
            } else if (seg.artifact.type === 'workflow-card') {
              // Persist the proposed workflow + expand into pending_actions
              // so the founder can approve/edit each step from the inbox.
              captureWorkflow({
                userId,
                projectId: project_id,
                artifact: seg.artifact as WorkflowCard,
                chatTurnPreview: lastMessage.slice(0, 200),
              });
            }
          }
        } catch (err) {
          console.warn('[chat] memory write failed (non-fatal):', err);
        }
      },
    }));

    return new Response(telemetryStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('Pi Agent SDK error, falling back to direct LLM:', err);
  }

  // Fallback: direct LLM (works without Pi Agent SDK)
  const fullMessages = buildDirectMessages(project_id, step, messages);
  const directStart = Date.now();
  let directResponseLen = 0;
  let directResponseText = '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of chatStream(fullMessages, provider)) {
          directResponseLen += chunk.length;
          directResponseText += chunk;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
        }
        const latencyMs = Date.now() - directStart;
        const model = provider === 'anthropic'
          ? (process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514')
          : (process.env.OPENAI_MODEL || 'gpt-4o');
        const dUsage = { output_tokens: Math.round(directResponseLen / 4) };
        logUsageToSQLite(project_id, null, step, provider, model, dUsage, 0, latencyMs);
        logToLangfuse(
          { projectId: project_id, step, provider: provider as 'anthropic' | 'openai', model },
          dUsage, 0, latencyMs,
          lastMessage.slice(0, 1000),
          directResponseText.slice(0, 2000),
        );
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function buildDirectMessages(projectId: string, step: string, messages: { role: string; content: string }[]) {
  let systemPrompt = STEP_SYSTEM_PROMPTS[step] || STEP_SYSTEM_PROMPTS['chat'];

  const projectRows = query<{ name: string; description: string }>(
    'SELECT name, description FROM projects WHERE id = ?', projectId
  );
  if (projectRows.length > 0) {
    systemPrompt += `\n\nProject: "${projectRows[0].name}"${projectRows[0].description ? ` — ${projectRows[0].description}` : ''}`;
  }

  const ideaRows = query('SELECT * FROM idea_canvas WHERE project_id = ?', projectId);
  if (ideaRows.length > 0) {
    systemPrompt += `\n\nCurrent Idea Canvas:\n${JSON.stringify(ideaRows[0], null, 2)}`;
  }

  return [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];
}

/** Build context from completed skills to inject into skill kickoff prompts */
function buildCompletedSkillContext(projectId: string, message: string): string {
  // Only inject for skill kickoff messages
  const { SKILL_KICKOFFS } = require('@/lib/stages');
  const isKickoff = Object.values(SKILL_KICKOFFS).some((k: string) => message.includes(k));
  if (!isKickoff) return '';

  const completions = query<{ skill_id: string; summary: string; completed_at: string }>(
    'SELECT skill_id, summary, completed_at FROM skill_completions WHERE project_id = ? AND status = ?',
    projectId, 'completed',
  );

  if (completions.length === 0) return '';

  const TOTAL_BUDGET = 8000;
  const perSkillBudget = Math.min(2000, Math.floor(TOTAL_BUDGET / completions.length));
  const artifactRegex = /:::artifact[\s\S]*?:::/g;

  let context = '[COMPLETED SKILL DATA — You MUST reference this data in your analysis. Do not generate from scratch.]\n';
  for (const c of completions) {
    const clean = (c.summary || '').replace(artifactRegex, '').trim();
    const truncated = clean.slice(0, perSkillBudget);
    context += `--- ${c.skill_id} (completed ${c.completed_at?.split('T')[0] || 'recently'}) ---\n${truncated}\n\n`;
  }
  context += '[END COMPLETED SKILL DATA]\n\n';

  return context;
}
