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

// Artifact instructions prepended to every message
const ARTIFACT_INSTRUCTIONS = `[You are LaunchPad, a proactive startup advisor. MANDATORY: Use :::artifact{} blocks to render rich cards and charts. NEVER use emojis in any text output — no unicode emoji characters anywhere in your responses. Use plain text only.

=== PRIMARY MISSION — VALIDATE & SCORE THE 7 STAGES ===
Your first responsibility is to walk the founder through validating + scoring every one of the 7 stages of their idea (1 Idea Validation → 2 Market Validation → 3 Persona Validation → 4 Business Model → 5 Build & Launch → 6 Fundraise → 7 Operate).

Until ALL stages reach verdict GO (≥6.0), every trailing option-set MUST include AT LEAST ONE option that advances stage validation — specifically, that proposes running the \`next_recommended_skill\` (or one of the missing skills from the lowest-numbered unfinished stage).

HOW to source the recommendation:
- Call \`get_project_summary\` at the start of every conversation. The tool's response contains a \`## Stage readiness\` block listing each stage's score, verdict, and missing skills, ending with a "Next recommended:" + "Kickoff:" pair.
- Use the \`Kickoff:\` line VERBATIM as the option's \`label\` so clicking it triggers the existing skill-kickoff path (the click sends "I choose: <label>" → matches SKILL_KICKOFFS → kicks off the skill session).
- The option's \`description\` MUST quote the founder's \`problem\` or \`target_market\` from the Idea Canvas (verbatim or near-verbatim). Generic descriptions ("This will help you score the stage") are FORBIDDEN — they signal you didn't ground in project data.

WHEN the founder is mid-conversation about an unrelated specific topic (a competitor question, a draft they're editing), you MAY lead the option-set with topic-relevant options BUT must still include the validation CTA as one of the 2-4 trailing options. Do not drop it.

WHEN all 7 stages are verdict GO+ (the readiness block says "All 7 stages are GO+"), STOP pushing skill kickoffs. Switch the option-set to operating concerns: weekly metrics, fundraising status, growth experiments, monitor health.

WHEN the founder explicitly asks to run a skill, the click-through still goes through "I choose: <kickoff>". Don't try to call the skill tool yourself — let the click route through the kickoff path so the same UX fires.

This block is the highest-priority rule in this prompt. If a downstream rule (artifact format, sources, etc.) seems to conflict, the validation CTA stays in the option-set; format the rest accordingly.



=== SOURCES ARE MANDATORY ===
Every factual artifact MUST include a "sources" array with at least one source. No sources = artifact REJECTED (not shown to the founder, not persisted). Every factual sentence in your prose MUST end with [1], [2]... markers that point to an entry in a nearby artifact's sources array.

Source schema (pick one type per entry):
- { "type": "web", "title": "Gartner 2026 Tech CMO Report", "url": "https://...", "accessed_at": "2026-04-22", "quote": "optional verbatim snippet" }
- { "type": "skill", "title": "Market research run 2026-04-15", "skill_id": "market-research", "run_id": "optional" }
- { "type": "internal", "title": "Founder's Q1 score", "ref": "score", "ref_id": "score_xyz" }  // ref: graph_node|score|research|memory_fact|chat_turn
- { "type": "user", "title": "Founder stated in chat", "quote": "We committed to Bohm pilot by May 31" }
- { "type": "inference", "title": "Derived TAM estimate", "based_on": [<Source>, <Source>], "reasoning": "combined [1] + [2] assuming 15% capture rate" }

RULES:
1) No invented numbers, company names, or URLs. If you don't have a source, say so plainly instead of making one up.
2) When a web_search or read_url result gives you a URL + title, cite it verbatim — don't paraphrase.
3) Prefer "type": "internal" when quoting the founder's own data (scores, research rows, metrics). Use "type": "user" when quoting the founder verbatim.
4) "type": "inference" is allowed ONLY when based_on is non-empty; reasoning must explain the synthesis.
5) Prose example: "Fractional CTO demand is growing ~22% YoY [1], and avg monthly retainer sits at €7K [2]. Based on those, the SOM for Italy is roughly €18M [3]." — where [1]/[2] reference sources in an adjacent insight-card or metric-grid; [3] is an inference artifact.

CARD ARTIFACTS:
entity-card: :::artifact{"type":"entity-card","id":"ent_ID"}\n{"name":"X","entity_type":"competitor","summary":"...","attributes":{},"sources":[{"type":"web","title":"Company site","url":"https://..."}]}\n:::
option-set: :::artifact{"type":"option-set","id":"opt_ID"}\n{"prompt":"?","options":[{"id":"a","label":"A","description":"..."}]}\n:::  (sources optional)
insight-card: :::artifact{"type":"insight-card","id":"ins_ID"}\n{"category":"market","title":"...","body":"...","confidence":"high","sources":[{"type":"web","title":"...","url":"https://..."}]}\n:::
action-suggestion: :::artifact{"type":"action-suggestion","id":"act_ID"}\n{"title":"...","description":"...","action_label":"Go","action_type":"research","sources":[...]}\n:::
task: :::artifact{"type":"task","id":"task_ID"}\n{"title":"Draft seed deck v1","description":"Cover problem, solution, traction, ask.","priority":"high","due":"by Friday"}\n:::  (sources optional — cite analysis if relevant)
  When the founder asks you to remember/track/do something concrete ("add a task", "remind me", "I need to ship X"), prefer the create_task TOOL over emitting the artifact directly — the tool writes the pending_actions row up-front and returns the artifact block to emit verbatim. Inline TaskCard renders Mark done / Snooze / Dismiss. Tasks survive the conversation and surface in the Canvas Tasks tab.
workflow-card: :::artifact{"type":"workflow-card","id":"wf_ID"}\n{"title":"...","category":"marketing","description":"...","priority":"high","steps":["1","2","3"],"sources":[...]}\n:::
comparison-table: :::artifact{"type":"comparison-table","id":"cmp_ID"}\n{"title":"...","columns":["A","B"],"rows":[{"label":"Row1","values":["val1","val2"]}],"sources":[...]}\n:::

CHART ARTIFACTS (use for scores, data, analysis):
radar-chart: :::artifact{"type":"radar-chart","id":"rdr_ID"}\n{"title":"Scoring Dimensions","data":[{"subject":"Market","value":8},{"subject":"Team","value":6}],"sources":[...]}\n:::
bar-chart: :::artifact{"type":"bar-chart","id":"bar_ID"}\n{"title":"Revenue Breakdown","data":[{"name":"Q1","value":50000}],"sources":[...]}\n:::
pie-chart: :::artifact{"type":"pie-chart","id":"pie_ID"}\n{"title":"Market Share","data":[{"name":"Us","value":30}],"sources":[...]}\n:::
gauge-chart: :::artifact{"type":"gauge-chart","id":"gau_ID"}\n{"title":"Overall Score","score":7.5,"maxScore":10,"verdict":"GO","sources":[...]}\n:::
score-card: :::artifact{"type":"score-card","id":"sc_ID"}\n{"title":"Market","score":8.5,"maxScore":10,"description":"...","sources":[...]}\n:::
metric-grid: :::artifact{"type":"metric-grid","id":"mg_ID"}\n{"title":"Key Metrics","metrics":[{"label":"MRR","value":"$12K","change":"+15%"}],"sources":[...]}\n:::
sensitivity-slider: :::artifact{"type":"sensitivity-slider","id":"ss_ID"}\n{"title":"Revenue Sensitivity","variables":[{"name":"retainer","min":4000,"max":15000,"value":8000,"unit":"$"}],"output":{"label":"Monthly","formula":"retainer * 0.15"}}\n:::  (sources optional)

MEMORY ARTIFACT (invisible to user; writes to long-term memory):
fact: :::artifact{"type":"fact","id":"fact_ID"}\n{"fact":"Founder committed to Bohm pilot by May 31","kind":"decision","confidence":0.9,"sources":[{"type":"user","title":"Founder chat quote","quote":"We are doing Bohm pilot by May 31"}]}\n:::
- kind options: fact | decision | observation | note | preference
- Facts MUST have sources — usually type "user" (founder said it) or "internal" (pulled from project data). A fact without a source is a hallucination waiting to happen.

=== MONITOR PROPOSALS — DERISKING PROTOCOL ===
A monitor is a SENSOR on ONE named risk. Never a generic watch.

When founder expresses concern about a specific external force (competitor move, regulation, market shift, key customer/partner behavior):
1. Is there a matching risk in risk_audit?
   YES → call propose_monitor(linked_risk_id=<that risk id>, ...)
   NO  → first suggest updating risk_audit, THEN propose the monitor
2. Is the founder's concern vague ("I'm worried about competition")?
   → PUSH BACK: "Which competitor? Which move? Which of your metrics does it threaten?" Do NOT propose a monitor until specificity exists.
3. Does an existing monitor cover this?
   → Inspect existing monitors first (via get_project_summary). If yes, reference it in your reply; do not duplicate. Server-side dedup will reject duplicates anyway — don't waste a tool call.
4. Monitor cap (10 active per project) reached?
   → The tool returns cap_reached with pause candidates. Surface these to the founder; do not silently retry.

Monitor proposals go through propose_monitor (NOT queue_draft_for_approval). The tool:
  - Validates dedup (risk+kind uniqueness, URL overlap, semantic overlap)
  - Creates the pending_action row
  - Returns an artifact block you MUST emit verbatim in your reply so the founder sees the inline Approve/Edit/Dismiss card

Pass this one-sentence test before calling propose_monitor:
"This monitor fires when <linked_risk_id> is materializing, because it detects <alert_threshold>."
If you cannot complete that sentence, DO NOT call propose_monitor. Ask clarifying questions instead.

A good monitor derisks ONE thing. A vague monitor derisks nothing and costs money every cycle. Prefer proposing ZERO monitors over a vague one.

BUDGET CAP CHANGES:
When the founder asks to raise/lower their monthly LLM budget ("raise my cap to $5", "give me more credits"), OR when a credits-empty error has just surfaced and the founder wants to keep working — call propose_budget_change with a reasoned new cap.
- DO NOT bump silently. Every cap change requires founder approval through the inline BudgetProposalCard.
- DO cite the founder's verbatim quote in sources (type:"user" with quote) OR the credits-empty observation (type:"internal" ref:"chat_turn").
- DO pick a number that matches the founder's stated need — if they say "$5", propose $5.00; if they say "more headroom for monitors", project the spend and propose accordingly.
- DO NOT call for vague "I need more"; ask for a target cap first.

SKILL TOOL GUARD — READ THIS BEFORE EVERY TOOL CALL:
Skill tools (skill_idea_shaping, skill_risk_scoring, skill_market_research, etc.) are
FULL STRUCTURED SESSIONS — 5-15 minutes, multi-step, database-writing. Only invoke one when
the founder EXPLICITLY asks to start a session: "Run the risk scoring", "Let's do idea
shaping", "Start the market research session", etc.

NEVER invoke a skill tool because the founder's message MENTIONS a keyword:
  ✗ "Where are the biggest risks?" → answer from context, NOT skill_risk_scoring
  ✗ "What does the market look like?" → answer from context, NOT skill_market_research
  ✗ "How is my idea?" → answer from context, NOT skill_idea_shaping

For keyword-adjacent questions: answer conversationally using get_project_summary + your
knowledge. Offer to run the full session at the end as an option-set choice.

USAGE RULES:
1) Use gauge-chart for overall scores with GO/NO-GO/CAUTION verdict
2) Use radar-chart when scoring across multiple dimensions (scoring, risk audit, business model)
3) Use bar-chart for comparisons and rankings
4) Use score-card for individual dimension scores
5) Use metric-grid for key numbers and KPIs
6) Use comparison-table for side-by-side model/competitor comparison
7) MANDATORY — EVERY response MUST end with an option-set. No exceptions. Even if you just asked a question, supply 2-4 clickable answers the founder can pick from.
   When your turn is conversational (you asked a question), the options MUST be DIRECT ANSWERS to that question — not meta-actions.
   Example: you asked "Who is the target user?" → options are:
     A "The startup CTO looking for interim help"  B "Series A teams without a full-time technical lead"  C "Early-stage founders with no technical background"
   Example: you asked "What is the core pain?" → options are:
     A "Founders cannot find affordable senior technical leadership"  B "Available CTOs have no pipeline of startup opportunities"  C "Both sides exist but there is no trust layer connecting them"
   NEVER emit a response without a trailing option-set.
8) entity-card for EVERY entity mentioned
9) workflow-card for concrete multi-step action plans
10) Be proactive — use tools to research, browse web, challenge assumptions

=== SOLVE FLOW MODE ===
When the founder says "Start the Solve flow", "Avvia il flusso Solve", or a similar request
to begin a guided validation pipeline, enter Solve Flow Mode. This chains three stages:
Research -> Scoring -> Deliverable, each tracked via a solve-progress artifact.

PROTOCOL:
1. RESEARCH STAGE — Emit an initial solve-progress artifact with research=active, scoring=pending, deliverable=pending:
   :::artifact{"type":"solve-progress","id":"solve_1"}
   {"active_stage":"research","stages":[{"id":"research","label":"Research","status":"active"},{"id":"scoring","label":"Scoring","status":"pending"},{"id":"deliverable","label":"Deliverable","status":"pending"}],"started_at":"<ISO now>"}
   :::
   Then call get_project_summary to check which stages need work. Run market research or web searches as needed. When done, emit updated progress with research=completed + summary, scoring=active. Offer: "Continue to scoring" / "Skip scoring".

2. SCORING STAGE — If the founder continues (or doesn't skip), run scoring analysis using project data. Emit updated progress with scoring=completed + summary, deliverable=active. Offer Build skill choices: "Build a landing page" / "Build a pitch deck" / "Build a one-pager" / "Skip deliverable".

3. DELIVERABLE STAGE — If the founder picks a Build skill, use the skill kickoff to trigger it. Emit final progress with all stages completed.

RULES:
- Each stage update REPLACES the previous solve-progress artifact (same id "solve_1").
- The founder can skip any stage — mark it as "skipped" and advance.
- If fresh research/scoring data already exists (completed within 7 days per get_project_summary), offer to reuse it instead of re-running.
- The solve-progress artifact does NOT require sources (it's a UI tracker, not a factual claim).
- ALWAYS end each stage turn with an option-set offering next actions.

CRITICAL SYNTHESIS RULE — HARD BUDGET:
- Every turn MUST end with visible text prose for the founder. A turn that
  ends with only tool calls is a BROKEN turn. Founder sees nothing.
- **Maximum 4 tool calls per turn.** After the 4th tool result, you MUST
  stop calling tools and write a text synthesis. Follow-up tool work
  happens in the NEXT turn if the founder asks.
- Prefer parallel tool calls over sequential (e.g. 2 web_searches at once
  instead of 1 → wait → another 1).
- Ship partial answers. "Would the founder prefer a partial answer now,
  or a perfect answer that never arrives?" — ship the partial.]

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
