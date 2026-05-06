import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import crypto from 'crypto';
import { chatWithUsage } from '@/lib/llm';
import { STEP_SYSTEM_PROMPTS } from '@/lib/llm/prompts';
import { logUsageToSQLite, logToLangfuse, estimateCost } from '@/lib/telemetry';
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
import { getSkillTools, listSkillManifest } from '@/lib/skill-tools';
import { captureWorkflow } from '@/lib/workflow-capture';
import { pickModel } from '@/lib/llm/router';
import { rankSkillsForQuery } from '@/lib/skill-relevance';
import { persistArtifact } from '@/lib/artifact-persistence';

// Artifact instructions prepended to every message — structured as priority tiers.
const ARTIFACT_INSTRUCTIONS = `[You are LaunchPad, a proactive startup co-pilot. MANDATORY: Use :::artifact{} blocks to render rich cards and charts. NEVER use emojis in any text output — no unicode emoji characters anywhere in your responses. Use plain text only.

=== TIER 0 — EVERY-TURN RULES (never violate) ===
- Maximum 4 tool calls per turn. After the 4th, stop and synthesize.
- Every turn MUST end with visible prose AND a trailing option-set. No exceptions.
- Every factual artifact MUST include a non-empty "sources" array. No sources = REJECTED.
- Every factual sentence in prose MUST end with [1], [2]... markers.
- Prefer parallel tool calls over sequential.
- Ship partial answers over perfect-but-never-arriving answers.
- No invented numbers, company names, or URLs.

=== TIER 1 — CONVERSATION OPENER (first turn of every thread) ===
At the start of every conversation, call these tools IN PARALLEL:
1. \`get_project_summary\` — stage readiness + intelligence snapshot
2. \`list_intelligence_briefs\` — active synthesized correlations
3. \`list_ecosystem_alerts\` (days_back=7, min_relevance=0.8) — hot signals

THEN apply this decision tree to your opening:
- IF urgent intelligence exists (briefs with high-urgency recommended actions, OR hot signals with relevance >= 0.9):
  → LEAD with the intelligence. Frame each signal using the Three-Question Protocol (Tier 2). Put the validation CTA as the LAST option in the option-set, not the first.
- IF no urgent intelligence but some signals exist:
  → Acknowledge signals briefly ("Your ecosystem is quiet this week — one signal worth noting: ..."). Then proceed with normal validation flow.
- IF no signals at all:
  → Open with the standard validation pipeline flow (stage readiness, next recommended skill).

=== TIER 2 — SIGNAL-TO-RISK FRAMING (Three-Question Protocol) ===
When surfacing any intelligence signal or brief to the founder, ALWAYS frame it with:
1. **What happened?** — the factual signal (with source citation)
2. **Why does it matter to YOUR startup?** — connect to founder's risk audit, metrics, competitive position, or stage progress. If a risk_audit entry matches, cite it by id.
3. **What to do about it?** — concrete action: monitor proposal, experiment, pivot consideration, or "note and watch"

Emit an insight-card artifact for each signal-risk connection worth surfacing.

When a signal connects to an existing risk from get_risk_audit:
- Reference the risk id and explain the connection
- If an early_warning_signal on that risk matches the new signal, call it out explicitly ("This is the early warning signal for risk_004 materializing")
- If no monitor covers that risk+signal pair, suggest proposing one

=== TIER 3 — VALIDATION PIPELINE (7-stage progression) ===
Walk the founder through validating the 7 stages (1 Idea → 2 Market → 3 Persona → 4 Business Model → 5 Build & Launch → 6 Fundraise → 7 Operate).

Until ALL stages reach verdict GO (>=6.0), every trailing option-set MUST include AT LEAST ONE option that advances stage validation — specifically, the \`next_recommended_skill\` from the readiness block.

HOW to source the recommendation:
- The \`get_project_summary\` response contains a \`## Stage readiness\` block with scores, verdicts, missing skills, and a "Next recommended:" + "Kickoff:" pair.
- Use the \`Kickoff:\` line VERBATIM as the option's \`label\`.
- The option's \`description\` MUST quote the founder's \`problem\` or \`target_market\` from the Idea Canvas (verbatim or near-verbatim). Generic descriptions are FORBIDDEN.

PRIORITY RULES:
- When urgent signals exist (Tier 1 decision tree): the validation CTA yields first position to intelligence. It still appears in the option-set but NOT as the first option.
- When the founder is mid-conversation about a specific topic: lead with topic-relevant options, validation CTA as trailing option.
- When all 7 stages are verdict GO+: STOP pushing skill kickoffs. Switch to operating concerns: weekly metrics, fundraising status, growth experiments, monitor health, risk management.
- When the founder explicitly asks to run a skill: route through "I choose: <kickoff>" click path.

=== TIER 4 — ARTIFACT FORMATS (reference) ===

SOURCES schema (pick one type per entry):
- { "type": "web", "title": "...", "url": "https://...", "accessed_at": "2026-04-22", "quote": "optional" }
- { "type": "skill", "title": "...", "skill_id": "...", "run_id": "optional" }
- { "type": "internal", "title": "...", "ref": "score|graph_node|research|memory_fact|chat_turn", "ref_id": "..." }
- { "type": "user", "title": "Founder stated in chat", "quote": "verbatim quote" }
- { "type": "inference", "title": "...", "based_on": [<Source>, <Source>], "reasoning": "..." }

CARD ARTIFACTS:
entity-card: :::artifact{"type":"entity-card","id":"ent_ID"}\n{"name":"X","entity_type":"competitor","summary":"...","attributes":{},"sources":[...]}\n:::
option-set: :::artifact{"type":"option-set","id":"opt_ID"}\n{"prompt":"?","options":[{"id":"a","label":"A","description":"..."}]}\n:::  (sources optional)
insight-card: :::artifact{"type":"insight-card","id":"ins_ID"}\n{"category":"market","title":"...","body":"...","confidence":"high","sources":[...]}\n:::
action-suggestion: :::artifact{"type":"action-suggestion","id":"act_ID"}\n{"title":"...","description":"...","action_label":"Go","action_type":"research","sources":[...]}\n:::
task: :::artifact{"type":"task","id":"task_ID"}\n{"title":"...","description":"...","priority":"high","due":"by Friday"}\n:::  (sources optional)
  When the founder asks to remember/track/do something, prefer the create_task TOOL over emitting the artifact directly.
workflow-card: :::artifact{"type":"workflow-card","id":"wf_ID"}\n{"title":"...","category":"marketing","description":"...","priority":"high","steps":["1","2","3"],"sources":[...]}\n:::
comparison-table: :::artifact{"type":"comparison-table","id":"cmp_ID"}\n{"title":"...","columns":["A","B"],"rows":[{"label":"Row1","values":["val1","val2"]}],"sources":[...]}\n:::

CHART ARTIFACTS:
radar-chart: :::artifact{"type":"radar-chart","id":"rdr_ID"}\n{"title":"...","data":[{"subject":"Market","value":8}],"sources":[...]}\n:::
bar-chart: :::artifact{"type":"bar-chart","id":"bar_ID"}\n{"title":"...","data":[{"name":"Q1","value":50000}],"sources":[...]}\n:::
pie-chart: :::artifact{"type":"pie-chart","id":"pie_ID"}\n{"title":"...","data":[{"name":"Us","value":30}],"sources":[...]}\n:::
gauge-chart: :::artifact{"type":"gauge-chart","id":"gau_ID"}\n{"title":"...","score":7.5,"maxScore":10,"verdict":"GO","sources":[...]}\n:::
score-card: :::artifact{"type":"score-card","id":"sc_ID"}\n{"title":"...","score":8.5,"maxScore":10,"description":"...","sources":[...]}\n:::
metric-grid: :::artifact{"type":"metric-grid","id":"mg_ID"}\n{"title":"...","metrics":[{"label":"MRR","value":"$12K","change":"+15%"}],"sources":[...]}\n:::
sensitivity-slider: :::artifact{"type":"sensitivity-slider","id":"ss_ID"}\n{"title":"...","variables":[{"name":"retainer","min":4000,"max":15000,"value":8000,"unit":"$"}],"output":{"label":"Monthly","formula":"retainer * 0.15"}}\n:::  (sources optional)

MEMORY ARTIFACT (invisible to user; writes to long-term memory):
fact: :::artifact{"type":"fact","id":"fact_ID"}\n{"fact":"...","kind":"decision","confidence":0.9,"sources":[{"type":"user","title":"...","quote":"..."}]}\n:::
- kind options: fact | decision | observation | note | preference
- Facts MUST have sources.

USAGE RULES:
1) gauge-chart for overall scores with GO/NO-GO/CAUTION verdict
2) radar-chart for multi-dimension scoring
3) bar-chart for comparisons and rankings
4) score-card for individual dimension scores
5) metric-grid for key numbers and KPIs
6) comparison-table for side-by-side comparison
7) option-set is MANDATORY on every response. When conversational, options MUST be direct answers to the question asked.
8) entity-card for EVERY entity mentioned
9) workflow-card for concrete multi-step action plans
10) Be proactive — use tools to research, browse web, challenge assumptions

=== TIER 5 — TRIGGERED PROTOCOLS (activated by specific contexts) ===

MONITOR PROPOSALS — DERISKING PROTOCOL:
A monitor is a SENSOR on ONE named risk. Never a generic watch.
When founder expresses concern about a specific external force:
1. Risk in risk_audit? → propose_monitor(linked_risk_id=<id>)
2. Vague concern? → PUSH BACK for specificity before proposing
3. Existing monitor covers it? → reference it, don't duplicate
4. Cap reached? → surface pause candidates
Pass the one-sentence test: "This monitor fires when <linked_risk_id> is materializing, because it detects <alert_threshold>."
A good monitor derisks ONE thing. Prefer ZERO monitors over a vague one.

BUDGET CAP CHANGES:
Call propose_budget_change when the founder explicitly asks to raise/lower cap, or when credits-empty and they want to continue. Cite the founder quote or error in sources. Never bump silently.

SKILL TOOL GUARD:
Skill tools are FULL STRUCTURED SESSIONS (5-15 min, multi-step). Only invoke when the founder EXPLICITLY asks to start a session. For keyword-adjacent questions ("Where are the biggest risks?"), answer from context using get_risk_audit + list_intelligence_briefs + list_ecosystem_alerts. Offer the full session as an option-set choice.

SOLVE FLOW MODE:
Triggered by "Start the Solve flow" / "Avvia il flusso Solve". Chains Research → Scoring → Deliverable via solve-progress artifact (same id "solve_1" on updates). Founder can skip stages. Reuse fresh data (< 7 days). Always end each stage with option-set.]

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

  const projects = await query<{ id: string; name: string; description: string }>(
    'SELECT id, name, description FROM projects WHERE id = ?', project_id
  );
  if (projects.length === 0) {
    return new Response(
      JSON.stringify({ success: false, error: 'Project not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Cost tracking (observe mode — no hard block)
  const capStatus = await isProjectCapped(project_id);
  if (capStatus.capped) {
    console.info(`[chat] project ${project_id} over budget — proceeding (observe mode)`);
  }

  const lastMessage = messages[messages.length - 1]?.content || '';
  const projectContext = `[PROJECT: "${projects[0].name}"${projects[0].description ? ` — ${projects[0].description}` : ''}]\n`;

  // Memory context — curated facts + recent events + graph summary + completed
  // skills — lets the agent remember across sessions AND across chat "steps"
  // within a project (see sessionId change below).
  const memoryContext = await buildMemoryContext(userId, project_id);

  // Build system prompt: SOUL + AGENTS personality first (locale-aware),
  // then ARTIFACT_INSTRUCTIONS, then per-project context + memory + recently-
  // completed skill summaries. SOUL/AGENTS were previously missing from the
  // chat path — they're now loaded from agents/*.md (or .it.md).
  const locale = await resolveProjectLocale(project_id, query);
  const skillContext = await buildCompletedSkillContext(project_id, lastMessage);
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

    // Skills-as-tools with per-turn Haiku relevance filtering. Keeps all
    // 11 skills auto-invokable but only exposes the top-3 most relevant
    // to the agent on each turn, preventing the "20-tool drowning" that
    // previously caused timeouts. Classifier cost ~$0.0003 + 300-500ms,
    // saves more in reduced tool-description tokens.
    const skillManifest = listSkillManifest();
    const relevantManifest = await rankSkillsForQuery(
      lastMessage,
      {
        id: project_id,
        name: projects[0].name,
        description: projects[0].description || '',
        current_step: (projects[0] as { current_step?: number }).current_step ?? 1,
      },
      skillManifest,
      { topN: 3 },
    );
    const relevantIds = new Set(relevantManifest.map((s) => s.id));
    const allSkillTools = getSkillTools({ userId, projectId: project_id });
    const skillTools = allSkillTools.filter((t) => {
      // Tool name format is `skill_<id-with-underscores>` — recover the id.
      const id = t.name.replace(/^skill_/, '').replace(/_/g, '-');
      return relevantIds.has(id);
    });

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
    // Captured from the SSE `done` event emitted by runAgentStream on agent_end.
    let streamUsage: { input_tokens?: number; output_tokens?: number; total_tokens?: number; cost?: number } | undefined;
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
                // Capture real token usage from the `done` SSE event
                if (payload.done && payload.usage) {
                  streamUsage = payload.usage;
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
      async flush(controller) {
        const latencyMs = Date.now() - piStart;
        // Pull the actual provider+model from the router so the logged slug
        // reflects reality (direct Anthropic vs OpenRouter). Falls back to
        // PI_PROVIDER/PI_MODEL env vars for call sites without a task label.
        const picked = pickModel('chat');
        const piProvider = picked.provider;
        const piModel = picked.model;
        const usage = {
          input_tokens: streamUsage?.input_tokens ?? 0,
          output_tokens: streamUsage?.output_tokens ?? 0,
        };
        const cost = streamUsage?.cost ?? estimateCost(piProvider, piModel, usage);
        await logUsageToSQLite(project_id, null, step, piProvider, piModel, usage, cost, latencyMs);
        logToLangfuse(
          { projectId: project_id, step, provider: piProvider as 'anthropic' | 'openai' | 'openrouter', model: piModel },
          usage, cost, latencyMs,
          lastMessage.slice(0, 1000), fullResponse.slice(0, 2000),
        );

        // Persist the turn to chat_messages so that on page refresh,
        // GET /api/chat/history can rebuild the thread. The JSONL pi-agent
        // session is the source of truth for agent memory, but the UI
        // reads from chat_messages (SQLite, user-scoped). Two rows per
        // turn: user prompt + assistant response. We persist the plain
        // text from fullResponse — artifact blocks stay in fullResponse
        // for the parser downstream, but the UI's copy/paste + rehydrate
        // works on the visible prose too. Non-fatal on failure.
        try {
          const now = new Date().toISOString();
          await run(
            `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
             VALUES (?, ?, ?, 'user', ?, ?, ?)`,
            `msg_${crypto.randomUUID().slice(0, 12)}`,
            project_id, step, lastMessage, now, userId,
          );
          if (fullResponse.trim().length > 0) {
            await run(
              `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
               VALUES (?, ?, ?, 'assistant', ?, ?, ?)`,
              `msg_${crypto.randomUUID().slice(0, 12)}`,
              project_id, step, fullResponse, now, userId,
            );
          }
        } catch (err) {
          console.warn('[chat] chat_messages persist failed (non-fatal):', err);
        }

        // Memory: chat_turn event + fact artifact extraction.
        // Wrapped in try so memory failures never break the stream response.
        try {
          await recordEvent({
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
          // Track source-enforcement rejections so we can tune prompts if the
          // agent repeatedly produces unsourced artifacts. Each rejection is
          // a memory_event with the artifact type + reason — queryable later
          // for "how often does Sonnet skip sources on entity-cards?"-style
          // analysis. Does NOT throw — source enforcement is non-fatal to
          // the stream; the founder just doesn't see the invalid card.
          const rejected = segments.filter((s) => s.type === 'artifact-error');
          if (rejected.length > 0) {
            try {
              await recordEvent({
                userId,
                projectId: project_id,
                eventType: 'artifact_rejected_no_sources',
                payload: {
                  count: rejected.length,
                  rejections: rejected
                    .filter((r): r is Extract<typeof r, { type: 'artifact-error' }> => r.type === 'artifact-error')
                    .map((r) => ({ artifact_type: r.artifact_type, reason: r.reason })),
                },
              });
              console.warn(
                `[chat] ${rejected.length} artifact(s) rejected for missing sources:`,
                rejected
                  .filter((r): r is Extract<typeof r, { type: 'artifact-error' }> => r.type === 'artifact-error')
                  .map((r) => `${r.artifact_type}: ${r.reason}`)
                  .join('; '),
              );
            } catch {
              // non-fatal — observability only
            }
          }
          for (const seg of segments) {
            if (seg.type !== 'artifact') continue;
            if (seg.artifact.type === 'fact') {
              const f = seg.artifact as FactArtifact;
              if (f.fact && typeof f.fact === 'string') {
                await recordFact({
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
            } else {
              // All other artifact types — entity-card, insight-card, gauge-
              // chart, radar-chart, score-card, metric-grid, comparison-table,
              // action-suggestion — get dispatched to their type-specific
              // persister in src/lib/artifact-persistence.ts. Each handler
              // upserts to graph_nodes / scores / research / pending_actions
              // as appropriate so the canvas data survives page refreshes
              // and populates the graph + dashboard views.
              const persistResult = await persistArtifact({ userId, projectId: project_id }, seg.artifact);
              if (!persistResult.persisted && persistResult.note === 'out of credits') {
                console.warn(`[chat] dropped ${seg.artifact.type} artifact: out of credits`);
              }
            }
          }
        } catch (err) {
          console.warn('[chat] memory write failed (non-fatal):', err);
        }

        // Emit done event with cost + credits so the client can show per-message credits
        try {
          const donePayload: Record<string, unknown> = { done: true };
          if (typeof cost === 'number' && cost > 0) {
            // Compute credits from cost using the project's budget configuration
            let credits = 0;
            try {
              const budgetRow = (await query<{ cap_llm_usd: number; cap_credits: number }>(
                `SELECT cap_llm_usd, cap_credits FROM project_budgets
                 WHERE project_id = ? AND period_month = ?`,
                project_id,
                (() => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })(),
              ))[0];
              if (budgetRow && budgetRow.cap_llm_usd > 0) {
                credits = Math.round(cost * (budgetRow.cap_credits / budgetRow.cap_llm_usd));
              }
            } catch { /* non-fatal — credits just stays 0 */ }
            donePayload.usage = { cost, credits };
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(donePayload)}\n\n`));
        } catch { /* non-fatal */ }
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

  // Fallback: direct LLM with real token tracking (works without Pi Agent SDK).
  // Uses chatWithUsage (non-streaming) instead of chatStream so we get exact
  // token counts. Acceptable tradeoff: this path only fires when the Pi Agent
  // SDK throws — the primary chat path above handles streaming.
  const fullMessages = await buildDirectMessages(project_id, step, messages);
  const directStart = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const model = provider === 'anthropic'
          ? (process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514')
          : (process.env.OPENAI_MODEL || 'gpt-4o');
        const { text: directResponseText, usage: dUsage } = await chatWithUsage(fullMessages, provider);
        const latencyMs = Date.now() - directStart;
        const cost = estimateCost(provider, model, dUsage);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: directResponseText })}\n\n`));
        await logUsageToSQLite(project_id, null, step, provider, model, dUsage, cost, latencyMs);
        logToLangfuse(
          { projectId: project_id, step, provider: provider as 'anthropic' | 'openai', model },
          dUsage, cost, latencyMs,
          lastMessage.slice(0, 1000),
          directResponseText.slice(0, 2000),
        );
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, usage: { cost } })}\n\n`));
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

async function buildDirectMessages(projectId: string, step: string, messages: { role: string; content: string }[]) {
  let systemPrompt = STEP_SYSTEM_PROMPTS[step] || STEP_SYSTEM_PROMPTS['chat'];

  const projectRows = await query<{ name: string; description: string }>(
    'SELECT name, description FROM projects WHERE id = ?', projectId
  );
  if (projectRows.length > 0) {
    systemPrompt += `\n\nProject: "${projectRows[0].name}"${projectRows[0].description ? ` — ${projectRows[0].description}` : ''}`;
  }

  const ideaRows = await query('SELECT * FROM idea_canvas WHERE project_id = ?', projectId);
  if (ideaRows.length > 0) {
    systemPrompt += `\n\nCurrent Idea Canvas:\n${JSON.stringify(ideaRows[0], null, 2)}`;
  }

  return [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];
}

/** Build context from completed skills to inject into skill kickoff prompts */
async function buildCompletedSkillContext(projectId: string, message: string): Promise<string> {
  // Only inject for skill kickoff messages
  // Lazy require keeps stages out of the top-level import graph (avoids a
  // server-only cycle). Cast back to the typed signature exported by stages.ts
  // so `Object.values()` doesn't degrade to `unknown[]`.
  const { SKILL_KICKOFFS } = require('@/lib/stages') as { SKILL_KICKOFFS: Record<string, string> };
  const isKickoff = Object.values(SKILL_KICKOFFS).some((k) => message.includes(k));
  if (!isKickoff) return '';

  const completions = await query<{ skill_id: string; summary: string; completed_at: string }>(
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
