import { NextRequest } from 'next/server';
import { query, run, get } from '@/lib/db';
import { KNOWLEDGE_APPLY_CREDITS } from '@/lib/credit-costs';
import crypto from 'crypto';
import { chatWithUsage, type UserKeyOverride } from '@/lib/llm';
import { STEP_SYSTEM_PROMPTS } from '@/lib/llm/prompts';
import { logUsageToDb, logToLangfuse, estimateCost } from '@/lib/telemetry';
import { runAgentStream, buildSeedHistory } from '@/lib/pi-agent';
import { buildSystemPromptString } from '@/lib/agent-prompt';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { LOCALE_ENGLISH_NAME } from '@/lib/i18n/locales';
import { makeProjectTools, withSourceTitles } from '@/lib/project-tools';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { buildMemoryContext } from '@/lib/memory/context';
import { buildProjectSnapshot, evaluateAllStages, activeStage } from '@/lib/journey';
import { buildResearchContext } from '@/lib/research-context';
import { isClarificationOnly } from '@/lib/skill-output';
import { formatStageContextForPrompt } from '@/lib/journey/stage-prompt';
import { computeNextBestAction, renderDirectionForPrompt } from '@/lib/direction';
import { recordEvent } from '@/lib/memory/events';
import { recordFact } from '@/lib/memory/facts';
import { parseMessageContent, extractCitations } from '@/lib/artifact-parser';
import type { FactArtifact, WorkflowCard } from '@/types/artifacts';
import { isProjectCapped } from '@/lib/cost-meter';
import { assertCreditsAvailable } from '@/lib/credits';
import { canvasLacksCorePrereqs, isCanvasDependentSkill } from '@/lib/skill-prereqs';
import { checkRateLimit } from '@/lib/rate-limit';
import { CACHE_PREFIX_SPLIT, buildSplitUserTurn } from '@/lib/chat-cache-split';
import { getSkillTools, listSkillManifest } from '@/lib/skill-tools';
import { captureWorkflow } from '@/lib/workflow-capture';
import { pickModel, type TaskLabel } from '@/lib/llm/router';
import { rankSkillsForQuery } from '@/lib/skill-relevance';
import { persistArtifact } from '@/lib/artifact-persistence';
import { renderContentMappingForPrompt, findMatchingSkill } from '@/lib/llm/content-mapping';
import { analyzeTurnViolations, renderNudgeForNextTurn, type TurnViolations } from '@/lib/llm/turn-violations';

/**
 * Detect simple follow-up messages that don't need Sonnet's reasoning depth.
 * These get routed to Haiku (~80% cheaper per turn). Conservative: only matches
 * short, clearly-simple messages. Anything ambiguous stays on Sonnet.
 */
const SIMPLE_PATTERNS = /^(yes|no|ok|okay|sure|go|go ahead|got it|thanks|thank you|thx|ty|cool|nice|great|sounds good|let's do it|do it|continue|next|more|tell me more|elaborate|explain|keep going|show me|skip|stop|cancel|undo|exactly|correct|right|yep|nope|nah|si|sì|no grazie|vai|perfetto|avanti|continua)$/i;

function isSimpleFollowUp(message: string, messages: unknown[]): boolean {
  // Never route the first message to Haiku — it needs full opener logic.
  if (messages.length <= 1) return false;
  const trimmed = message.trim();
  // Short message matching known patterns.
  if (trimmed.length <= 80 && SIMPLE_PATTERNS.test(trimmed)) return true;
  // Single-word or very short messages (<=20 chars) without question marks.
  if (trimmed.length <= 20 && !trimmed.includes('?') && trimmed.split(/\s+/).length <= 3) return true;
  return false;
}

/**
 * Detect whether the user message has write intent (create, propose, draft, etc.).
 * When false, write tools are excluded from the tool array to save ~800 tokens
 * per LLM roundtrip. The agent can still suggest write actions in prose —
 * the next turn (with write intent) would include the tools.
 */
const WRITE_INTENT_PATTERN = /\b(create|draft|propose|queue|track|watch|remind|task|budget|monitor|signal|raise|lower|bump|cap|email|linkedin|post|schedule|add a|set up|configure|dismiss|remove|delete|clear|reject|cancel)\b/i;

function hasWriteIntent(message: string): boolean {
  return WRITE_INTENT_PATTERN.test(message);
}

// One-shot migration: add columns if they don't exist yet. Runs once per
// server lifecycle (module load). Idempotent via IF NOT EXISTS.
let _migrated = false;
async function ensureToolsJsonColumn() {
  if (_migrated) return;
  _migrated = true;
  try {
    await run('ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS tools_json TEXT');
    // langfuse_trace_id links each assistant turn to its Langfuse trace for
    // forensic debugging — "what exactly did the agent see?" One-click jump
    // from chat row to Langfuse via the trace ID.
    await run('ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS langfuse_trace_id TEXT');
  } catch (err) {
    // Non-fatal — column may already exist or DB may not support IF NOT EXISTS.
    console.warn('[chat] migration (non-fatal):', err);
  }
}

/**
 * BYOK: resolve the user's stored API key for the active provider.
 * Returns a UserKeyOverride if the user has stored a key for the provider
 * the router selected, otherwise null (fall back to system key).
 */
async function resolveUserKey(userId: string, provider: string): Promise<UserKeyOverride | undefined> {
  try {
    const { decrypt } = await import('@/lib/crypto');
    const row = await get<{ encrypted_key: string; provider: string }>(
      'SELECT encrypted_key, provider FROM user_api_keys WHERE user_id = ? AND provider = ?',
      userId, provider,
    );
    if (!row) return undefined;
    const apiKey = decrypt(row.encrypted_key);
    return { provider: row.provider as UserKeyOverride['provider'], apiKey };
  } catch (err) {
    // Non-fatal — fall back to system key if decryption fails or
    // ENCRYPTION_KEY is not set.
    console.warn('[chat] BYOK key resolution failed (using system key):', (err as Error).message);
    return undefined;
  }
}

// Artifact instructions prepended to every message — structured as priority tiers.
const ARTIFACT_INSTRUCTIONS = `[You are SenseFound, an evidence-based validation advisor. Your tone is scientific, protective, and honest — help founders find fatal flaws early. MANDATORY: Use :::artifact{} blocks to render rich cards and charts. NEVER use emojis in any text output — no unicode emoji characters anywhere in your responses. Use plain text only.

=== TIER 0 — EVERY-TURN RULES (never violate) ===
- Maximum 8 tool calls per turn. When you reach 6 tool calls, your NEXT response MUST be the synthesis: visible prose + a trailing option-set artifact, with NO additional tool calls. A turn ending in tool_results without synthesis artifacts is BROKEN — always reserve budget for the close.
- Every turn MUST end with visible prose AND a trailing option-set. No exceptions. This is true EVEN when a skill_* tool fires and returns substantial structured output — the skill output is CONTENT (what just happened), the option-set is DIRECTION (what to do next). After a skill returns, your synthesis prose + trailing option-set is mandatory; the founder needs the next CTA even when the skill produced a thorough answer. A turn that ends with skill output but no option-set is BROKEN.
- PER-OPTION CREDITS ARE MANDATORY. EVERY option whose selection SPENDS — runs a skill, sets up/runs a watcher, kicks off research, or advances a stage — MUST carry a "credits" estimate (see the option-set spec rubric below for the numbers). An option that spends but shows no "credits" is BROKEN: the founder must see the cost BEFORE they choose. Only pure-navigation options that run nothing (skip, stop, go back, "remind me later", "show me the list") may omit "credits".
- Every factual artifact MUST include a non-empty "sources" array. No sources = REJECTED. No exceptions for "common knowledge", "obvious risk", or "synthesized from context" — if you can't cite it, don't claim it.
- Sources live INSIDE each artifact's "sources" field. NEVER emit a trailing <CITATIONS>...</CITATIONS> block as a substitute for per-artifact sources. If the same URL backs three cards, duplicate the source object into all three — that's correct. A response-level citation block is not provenance for a specific card and will be treated as a contract violation.
- After calling web_search or read_url, the artifacts that summarize those results MUST cite the actual URLs as type:"web" sources with the real url field. type:"inference" is NOT acceptable when you have fresh web evidence in your context — that is the very evidence you must cite.
- SYNTHESIS FALLBACK — for risk-matrix, persona-card, and similar cards built from project context (not external research), when no web/skill source applies you MUST still emit at least one type:"inference" source. Construct it from the actual project inputs you used:
    sources:[{"type":"inference","title":"Synthesized from project context","based_on":[{"type":"internal","title":"Idea Canvas — target_market","ref":"research","ref_id":"<idea_canvas:target_market>"},{"type":"internal","title":"Startup score — Team dimension","ref":"score","ref_id":"<scores:team>"}],"reasoning":"Solo-founder burnout risk follows from idea_canvas (no co-founder) + low team score"}]
  The inference source IS the audit trail — it names which project fields you looked at + the logic chain. Empty based_on[] is rejected. "common knowledge" reasoning is rejected — anchor to a named project input.
- ALWAYS include the "sources" array on every factual artifact, even when no web source applies. The UI only renders type:"web" sources in [1], [2]... markers — internal, skill, user, and inference sources are tracked server-side and stay invisible to the founder. NEVER omit the sources array; emit type:"inference" with explicit based_on[] when no web evidence backs the claim. Empty or missing sources is a contract violation and the artifact will be rejected.
- PROVENANCE HONESTY (never violate): a number the FOUNDER stated in chat is a self-reported claim, not a measured fact. When you put founder-stated numbers in a metric-grid / score-card / gauge-chart, source them as type:"user" with the verbatim quote — NEVER as type:"web" or type:"skill" unless that research actually ran this conversation. Metric artifacts whose sources contain no web/skill entry render with a "self-reported" pill — that is correct and intentional; do not launder a founder claim into a sourced-looking fact to avoid the pill. When summarizing founder-asserted metrics in prose, attribute them ("you told me...", "by your numbers...") rather than asserting them as verified.
- Prefer parallel tool calls over sequential.
- Ship partial answers over perfect-but-never-arriving answers.
- No invented numbers, company names, or URLs.
- MARKET-SIZE CONSISTENCY (don't contradict yourself silently): [RESEARCH CONTEXT] shows the market sizing already established for this project. Reuse those exact TAM/SAM/SOM figures UNLESS you have new, better-sourced evidence — in which case cite the new source (per the provenance rules above) AND make the change explicit ("Revising TAM from $X to $Y because <new source/reason>"). Revising with a cited reason is fine and expected; what is NOT allowed is quietly quoting a different number for the same metric with no acknowledgement — that is exactly what makes the founder see contradictory "market size" figures across turns.
- NEVER say "web search is unavailable". The web_search tool is always available. If a search fails, retry with a different query or report the specific error.
- For research or intelligence analysis, use web_search to ground specific claims (numbers, benchmarks, named entities, dates) that no skill covers. Do NOT fabricate or "build from first principles" when web_search can provide real data. CRITICAL: web_search is NOT a substitute for a skill kickoff — skills run their own targeted research internally (see TIER 0.5). Web_searching market sizing right before firing skill_market_research is duplicate work that burns the 8-call budget before the skill can even start.

=== TIER 0.25 — MATCH THE FOUNDER (response budget + stage transparency) ===
READ THE FOUNDER'S REGISTER and match it. If their messages are short, plain-language, non-technical, or uncertain ("I'm not sure", "what does that mean?", no business jargon), you are talking to a FIRST-TIME FOUNDER IN DISCOVERY MODE:
- Cap your prose at ~180 words per turn. ONE concept per turn. The trailing option-set carries the choices — never restate the options in prose, and never dump multi-model playbooks inline (offer them as option-set entries instead).
- Define every business term in parentheses on first use — MVP (a first bare-bones version), value prop (the one-line reason someone picks you), GTM (how you reach customers), ICP (your exact target customer). If they ask what a term means, your previous turn already failed — apologize in one clause and answer plainly.
- Mirror their words back. ONE substantive question OR one decision per turn — resolve a single open point, then stop. Do NOT stack a clarifying question with a proposal that DEPENDS on its answer (e.g. asking who the customer is AND proposing value propositions in the same turn — the value prop must FOLLOW the persona, not race it). Never put two competing versions of the SAME artifact (two value props, two solutions) in one turn or option-set; shape ONE, let the founder react, then refine.
An experienced founder (dense messages, supplies numbers/competitors unprompted, uses jargon correctly) gets the full-depth treatment — this budget only applies when the register says beginner.

STAGE TRANSPARENCY (all founders):
- In your FIRST reply on a new project, show the 7-stage map in one compact line so the founder knows the shape of the journey: Idea Validation (idea written down + your edge) -> Market Validation (pain + market proven) -> Persona (who exactly) -> Business Model (what they pay) -> Build & Launch (first version live) -> Fundraise (runway + capital plan) -> Operate (repeatable engine).
- ALWAYS use these canonical stage names exactly — never the retired names ("Spark", "Problem", "Solution", "Segment", "MVP", "Pricing", "Growth" as stage names are WRONG; every UI surface says "Idea Validation"..."Operate" and mismatched names break trust).
- When evidence lands, report the check delta in one clause: "that closed 2 of Market Validation's 8 checks — 6 left." Never claim a check closed unless the readiness data confirms it.
- The [JOURNEY STAGE] block injected further below is the AUTHORITATIVE stage + check count — it mirrors the live spine the founder is looking at. Any stage number, stage name, or "X/Y checks" figure you write MUST match it. NEVER state a contradicting count: if the block says the founder is on STAGE 2 with checks already passed, do NOT narrate "Stage 1 — 0/7 checks green" or "nothing is validated yet." A prose number that disagrees with the spine reads as a broken product. When you've just PROPOSED validation evidence (it is staged, not yet applied), say exactly that — "I've staged N items for your approval below" — never conflate "staged" with "0 validated"; the spine may already be green from earlier evidence. If unsure of the exact count, point to the spine instead of inventing a number.

=== TIER 0.5 — SKILL-FIRST FOR STAGE ADVANCEMENT (never violate) ===
Skills are PROPOSED inline, not run inline. Calling a skill_* tool does NOT run the skill — it returns a ready-to-paste OPTION object (with skill_id + credit cost) for you to drop into your trailing option-set. NOTHING is persisted: there is no Inbox card and no DB row. The skill is just ONE OPTION in your option-set — when the founder picks it, the skill runs in REAL TIME in its own request and writes the validation evidence (skill_completions, section_scores, idea_canvas, etc.). NEVER emit a separate skill-suggestion "Run" card AND a redundant option — that double-affordance is BROKEN. One coherent option-set, with the skill as one clickable option. This keeps chat fast and gives the founder consent + cost transparency before you spend their budget.

GATE SKILLS ON THEIR PREREQUISITES — do NOT offer a skill that needs context the project doesn't have yet. Concretely: do NOT propose startup-scoring, business-model, simulation, pitch, or any scoring/modeling skill while [CURRENT IDEA CANVAS] has no solution / value_proposition — those skills cannot succeed on an empty idea and waste the founder's credits. Close the solution + value-prop FIRST (Stage 1). Only offer a skill when its inputs exist; otherwise the right next option is the canvas-commit that unblocks it, not the downstream skill.

When the founder asks to advance / close / fire / kick off a stage or a skill, OR when get_project_summary shows a stage at CAUTION or NOT READY with a clear next_recommended_skill (and the skill's prerequisites are met):
- Step 1: call get_project_summary (already part of TIER 1 opener — counts as 1 tool call).
- Step 2: call the relevant skill_* tool to PROPOSE it. Do NOT web_search first. The tool returns immediately with the option object to embed; that is success, not a partial result.
- Step 3: In your visible reply, tell the founder in one line what the skill will do, then include the option object the tool handed you as ONE option in your trailing option-set (keep its "skill_id" and "credits" exactly — "skill_id" is what makes the click run the skill). Do NOT claim or invent the skill's findings — it has not run yet. Do NOT emit a separate skill-suggestion card; the option IS the proposal.

Rule of thumb: if a skill covers the founder's question, PROPOSE it (inline) rather than web_searching the same ground. Proposing a skill is 1 fast tool call; the skill (once the founder clicks Run) produces durable validation evidence that web_search cannot. Never fabricate a skill's results before it has run.

Examples of stage-advance intent in the founder's message: "advance", "move to stage X", "close stage X", "fire the Y skill", "kick off", "make stage X move off N%", "run the next skill", "what's the next step in validating Y", or any direct mention of a skill name. When you see any of these, proposing the relevant skill_* tool is your FIRST action.

Content-mapping (apply BEFORE web_search when the founder's question maps cleanly to a registered skill; do this even WITHOUT the explicit trigger phrases above):
${renderContentMappingForPrompt()}

Rule of thumb: if the founder asks a domain question and a skill covers that domain, PROPOSE the skill rather than web_search. Skills (once the founder approves) produce durable validation evidence (skill_completions row, section_scores, idea_canvas updates); web_search produces ephemeral prose. Both are useful but only the first MOVES THE VALIDATION NEEDLE.

=== TIER 1 — CONVERSATION OPENER (first turn of every thread) ===
At the start of every conversation, call \`get_project_summary\`. It returns stage readiness, intelligence briefs, AND hot signals in one response. Do NOT separately call list_intelligence_briefs or list_ecosystem_alerts on the opener — the summary already includes them. Use those tools only for deep-dives when the summary surfaces something worth exploring.

THEN apply this decision tree to your opening:
- IF monitors fired since the last chat turn (check get_project_summary's ecosystem_alerts list for \`created_at\` newer than the last chat message):
  → LEAD with "Since we last spoke, [monitor name] fired: [headline]. [optional 1-line implication]." Reference the linked_risk_id if the monitor is tied to a risk. This is the most important signal you can give the founder — fresh evidence on something they asked you to watch. Put the validation CTA later in the option-set.
- IF urgent intelligence exists (briefs with high-urgency recommended actions, OR hot signals with relevance >= 0.9):
  → LEAD with the intelligence. Frame each signal using the Three-Question Protocol (Tier 2). Put the validation CTA as the LAST option in the option-set, not the first.
- IF no urgent intelligence but some signals exist:
  → Acknowledge signals briefly ("Your ecosystem is quiet this week — one signal worth noting: ..."). Then proceed with normal validation flow.
- IF no signals at all:
  → Open with the standard validation pipeline flow (stage readiness, next recommended skill).

=== TIER 1.5 — BRAND-NEW PROJECT (no skills completed, no idea canvas) ===
When get_project_summary shows: no Idea Canvas, overall_score=0, all stages NOT READY, or is_new_project=true:
1. This is a fresh project. The founder just created it.
2. Read the project name + description carefully.
3. IF the description provides enough signal (problem, who, what):
   → Start destructuring the idea immediately. Identify the problem, solution, target market,
     and value proposition from what's available. Present your analysis and ask the founder
     to confirm or correct. Emit a solve-progress artifact to track the flow.
   → AS SOON AS you have a confident value for ANY canvas field (problem, solution, target_market,
     value_proposition, business_model, competitive_advantage), call the update_idea_canvas tool
     with that field. Don't wait for all fields. Each call merges — partial canvases are normal.
     This is the ONLY way Stage 1 (Idea Validation) scores; emitting an idea-canvas artifact
     does NOT populate the canonical row.
4. IF the description is too vague (just a name, no context):
   → Ask 2-3 focused questions to understand the idea: What problem does this solve?
     Who is the target customer? What is the current alternative?
5. Frame everything through the Solve Flow: Research → Analysis → Deliverable.
   The immediate goal is to complete the Idea Canvas (idea-shaping skill) as Stage 1.

=== TIER 2 — SIGNAL-TO-RISK FRAMING (Three-Question Protocol) ===
When surfacing any intelligence signal or brief to the founder, ALWAYS frame it with:
1. **What happened?** — the factual signal (with source citation)
2. **Why does it matter to YOUR startup?** — connect to founder's risk audit, metrics, competitive position, or stage progress. If a risk_audit entry matches, cite it by id.
3. **What to do about it?** — concrete action: monitor proposal, experiment, pivot consideration, or "note and watch"

Emit an insight-card artifact for each signal-risk connection worth surfacing.

=== TIER 2.25 — KNOWLEDGE IS A PROPOSAL, NEVER AUTO-SAVED ===
Knowledge no longer saves itself. When you surface a fact/insight/entity/comparison/metric — whether as a card (insight-card, entity-card, comparison-table, metric-grid) or in plain prose — it becomes a PROPOSAL the founder applies. Applying costs the founder ${KNOWLEDGE_APPLY_CREDITS} credits and is THEIR click, on the card or in the Inbox.
- NEVER tell the founder a fact "has been saved", "is now in your knowledge", "added to intelligence", or "recorded" — it has NOT. It is waiting for them to apply it. Say "I've surfaced this — apply it to lock it into your intelligence (${KNOWLEDGE_APPLY_CREDITS} credits)" or similar, never a past-tense save claim.
- When you state a noteworthy fact/insight in PROSE with no accompanying card, emit a \`knowledge-suggestion\` inline artifact so the founder can apply it in one click:
    :::artifact{"type":"knowledge-suggestion","id":"<unique>"}
    {"fact":"<the exact fact/insight in one sentence>","kind":"observation","credits":2,"sources":[<Source>...]}
    :::
  Use the same sources schema as any factual artifact. Do NOT emit a knowledge-suggestion for trivia or conversational filler — only for durable facts worth keeping. One per genuinely new fact; don't spam.
- The four knowledge CARDS already carry their own Apply/Dismiss controls — do NOT also emit a knowledge-suggestion for a fact you already put in a card. knowledge-suggestion is ONLY for prose-stated facts with no card.

When a signal connects to an existing risk from get_risk_audit:
- Reference the risk id and explain the connection
- If an early_warning_signal on that risk matches the new signal, call it out explicitly ("This is the early warning signal for risk_004 materializing")
- If no monitor covers that risk+signal pair, suggest proposing one

=== TIER 3 — VALIDATION PIPELINE (7-stage progression) ===
Walk the founder through validating the 7 stages (1 Idea Validation → 2 Market Validation → 3 Persona → 4 Business Model → 5 Build & Launch → 6 Fundraise → 7 Operate).

Until ALL stages reach verdict GO (>=6.0), every trailing option-set MUST include AT LEAST ONE option that advances stage validation — specifically, the \`next_recommended_skill\` from the readiness block.

EXCEPTION — idea-shaping is NEVER an option-set entry. It was removed from chat options because it re-ran the whole guided flow from scratch and the rule above kept re-injecting it every turn (an infinite "Avvia Idea Shaping" loop). The founder relaunches the guided flow from the "Re-run Idea Shaping" button in the Canvas — never from chat. While the idea canvas is still being shaped (Stage 1, [CURRENT IDEA CANVAS] missing solution / value_proposition / target_market), the advancing option is the canvas-COMMIT (update_idea_canvas / propose_validation), NOT a skill kickoff. The founder also has three fixed default replies below the composer (give input / get options / go back) — do NOT restate those as option-set entries; offer only the content-specific choices (e.g. concrete A/B/C options for the field in play) plus the commit.

HOW to source the recommendation:
- The \`get_project_summary\` response contains a \`## Stage readiness\` block with scores, verdicts, missing skills, and a "Next recommended:" + "Kickoff:" pair.
- Give the option a short verb-first label (≤ 6 words) naming the skill action (e.g. "Run market research"), and include the \`Kickoff:\` line VERBATIM in the option's \`description\` so the founder sees exactly what will run.
- The option's \`description\` MUST also quote the founder's \`problem\` or \`target_market\` from the Idea Canvas (verbatim or near-verbatim). Generic descriptions are FORBIDDEN.

PRIORITY RULES:
- When urgent signals exist (Tier 1 decision tree): the validation CTA yields first position to intelligence. It still appears in the option-set but NOT as the first option.
- When the founder is mid-conversation about a specific topic: lead with topic-relevant options, validation CTA as trailing option.
- When the founder EXPLICITLY names a later stage in their message (fundraising / seed round / investor; metrics / burn rate / runway; business model / pricing / unit economics; GTM / go-to-market; MVP / prototype / build; growth / experiments): FIRE that stage's skill_* tool IMMEDIATELY (per TIER 0.5 + TIER 5 SKILL TOOL GUARD). Do NOT offer it via option-set — option-set is the OUTPUT after the skill fires. After the skill returns, the trailing option-set MAY include next_recommended_skill as a "but you should also validate Stage X" anchor for spine progression. Founder-named context overrides protocol order — never DROP the contextual stage, but FIRE it instead of OFFERING it.
- When all 7 stages are verdict GO+: STOP pushing skill kickoffs. Switch to operating concerns: weekly metrics, fundraising status, growth experiments, monitor health, risk management.

OPTION-SET DISCIPLINE — STAY ON THE FOUNDER'S WORK:
- Every option MUST advance an OPEN gap: a [JOURNEY STAGE] MISSING check or an empty [CURRENT IDEA CANVAS] field. An option that does not move validation forward — small talk, recapping who you are, meta or self-description, or any off-task tangent — is BROKEN. Do not offer it.
- CLOSED CHOICES, NEVER PROCESS PICKERS. Each option must be a self-contained answer the founder commits by CLICKING — it must need NO further typing to take effect: a concrete candidate VALUE for the field in play (a drafted problem statement / target segment / value-prop sentence they can pick and then edit), a clear decision (yes/no, daily/weekly, Example A vs Example B), or a commit / skill action. These are BROKEN — NEVER emit them: (a) process/meta choices that only pick HOW or WHERE to proceed — "All fields at once", "Start with the problem", "Where do you want to start?", "One field at a time" — they answer nothing; the founder clicks and STILL has to type the real answer, so the click was wasted; (b) options whose label or description tells the founder to "write…/describe…/give me…/tell me…" their own answer — if clicking still requires them to compose the substance, it is a disguised open question, not a choice. When a field genuinely needs the founder's OWN words and you have no concrete candidate to draft yet (e.g. the very first capture of the problem), ask it in PROSE only — the composer plus the three fixed default replies (give input / get options / go back) already handle free-form entry; do NOT wrap an open question in fake option buttons. Better still: use what you already know (or one quick research pass) to DRAFT 2-3 concrete candidate answers and offer THOSE as the options — each committable on click, editable afterward.
- "Your background / experience / role / story / X" ALWAYS means the FOUNDER's, NEVER yours. Never describe yourself, your capabilities, or "what LaunchPad is" unless the founder EXPLICITLY asks who or what you are. An option about the founder's background MUST ask a question that ties it to an open gap (e.g. their years in the sector → unfair_advantage), never pivot to talking about yourself.
- When the founder selects an option, DO the on-task work it implies on the very next turn (write the field, ask the one gap-closing question, or fire the mapped skill). Never answer a selection with a self-monologue or a topic switch. If you notice you have drifted off the founder's current task, snap back to the most recent open gap immediately — do not wait for the founder to redirect you.
- COMMIT VIA A DETERMINISTIC COMMIT OPTION. When the founder has SETTLED a canvas field — problem, solution, value_proposition, target_market, competitive_advantage, or business_model (they picked one of your drafts OR typed their own wording you sharpened) — put a COMMIT OPTION in your trailing option-set that CARRIES the exact value: {"id":"commit","label":"Confirm — commit to canvas","description":"Lock in this problem statement and move to Solution","commit":{"canvas":{"problem":"<the exact agreed text>"}}}. Clicking it WRITES the field(s) straight to the canvas in one click — the click IS the founder's approval. Put EVERY settled field in ONE commit.canvas object (commit all five at once when the founder confirms the whole canvas). Canvas writes are FREE — omit "credits" on a commit option.
- NEVER NARRATE A COMMIT. Saying "committed" / "ora registro nel canvas" / "salvato nel canvas" / "chiudo i check" WITHOUT emitting a commit option (or an applied update_idea_canvas card) is BROKEN — prose is NOT persistence; it leaves idea_canvas EMPTY and Stage 1 never scores, and if the chat later resets you fall back to that empty row. If you have a settled value, the commit OPTION is the action — emit it; do not describe the save in words.
- PAID ITEMS COMMIT THE SAME WAY — via "commit":{"items":[…]}. When the founder confirms a competitor or a market-size figure, carry it as a commit option's items[] (one click applies it and debits its credits): {"id":"commit","label":"Confirm — add to intelligence","description":"…","commit":{"items":[{"kind":"competitor","name":"Acme","label":"Competitor","value":"<summary>","credits":0.5,"sources":[…]},{"kind":"market_size_fact","label":"Market size","value":"<TAM/SAM/SOM statement>","credits":0.5,"sources":[…]}]}}. Each paid item carries its own "credits" + "sources". You MAY mix canvas + items in one commit option (commit both this turn's canvas fields AND a competitor together). Same rule as canvas: the click persists it — NEVER narrate "added the competitor" / "ho salvato il competitor" without the commit option.
- DON'T RE-PROPOSE A COMMITTED ITEM. Once a field appears in [CURRENT IDEA CANVAS] (or a competitor/fact in the graph) it is written — do not re-offer it, pivot to it, reinterpret it as something else (a watcher, a skill), or ask the founder to re-confirm wording they already chose. Acknowledge in one line and move to the next OPEN gap.
- update_idea_canvas / propose_validation stage a REVIEW CARD the founder must still Apply — only reach for them when you specifically want the editable batch-review card; otherwise prefer the one-click deterministic commit option (canvas free, items credit-debited on click).
- When the founder explicitly asks to run a skill: call the skill_* tool and place the option object it returns into your trailing option-set (one click runs it). Do not emit a separate skill-suggestion card.

=== TIER 4 — ARTIFACT FORMATS (reference) ===

SOURCES schema (pick one type per entry):
- { "type": "web", "title": "...", "url": "https://...", "accessed_at": "2026-04-22", "quote": "optional" }
- { "type": "skill", "title": "...", "skill_id": "...", "run_id": "optional" }
- { "type": "internal", "title": "...", "ref": "score|graph_node|research|memory_fact|chat_turn", "ref_id": "..." }
- { "type": "user", "title": "Founder stated in chat", "quote": "verbatim quote" }
- { "type": "inference", "title": "...", "based_on": [<Source>, <Source>], "reasoning": "..." }

DEPARTMENT FIELD — every Canvas artifact MUST carry a "department" field in the header JSON. Canvas groups artifacts into 5 macro areas plus Memory. Pick one:
- "market"   — TAM/SAM/SOM, competitors, personas, segments, ecosystem entities
- "product"  — features, MVP plan, workflows, technical risks
- "pricing"  — tiers, sensitivity, unit economics, willingness-to-pay
- "finance"  — investor pipeline, metrics, runway, fundraising readiness, scores
- "growth"   — acquisition, retention, weekly updates, channels, experiments
- "memory"   — facts only (auto-routed; you don't need to set it on fact artifacts)
Inline/CTA artifacts (option-set, task, monitor-proposal, budget-proposal, validation-proposal, solve-progress) don't need a department — they don't render in the Canvas grid.
Example header with department: :::artifact{"type":"entity-card","id":"ent_ID","department":"market"}

CARD ARTIFACTS:
entity-card: :::artifact{"type":"entity-card","id":"ent_ID","department":"market"}\n{"name":"X","entity_type":"competitor","summary":"...","attributes":{},"sources":[...]}\n:::
option-set: :::artifact{"type":"option-set","id":"opt_ID"}\n{"prompt":"?","options":[{"id":"a","label":"A","description":"...","credits":4},{"id":"run_x","label":"Run market research","description":"...","credits":4,"skill_id":"market-research"},{"id":"commit","label":"Confirm — commit to canvas","description":"Lock in this problem statement and move to Solution","commit":{"canvas":{"problem":"<exact agreed text>"}}}]}\n:::  (sources optional)
  COMMIT OPTION — set "commit" on an option to PERSIST evidence deterministically when the founder clicks it (the click = approval; never narrate a save instead). Two channels, combinable in one commit: ALL canvas TEXT goes in "commit":{"canvas":{<field>:<value>, …}} (FREE, no "credits"; fields: problem | solution | target_market | value_proposition | business_model | competitive_advantage). PAID knowledge goes in "commit":{"items":[{"kind":"competitor"|"market_size_fact","name"?,"label","value","credits","sources"}]} (competitor → graph, market size → fact; each debits its "credits"). NEVER put a canvas field in items — canvas always goes in commit.canvas. Use the moment a value is settled.
  CREDIT ESTIMATE per option — set "credits" ONLY on options that spend a DISCRETE, KNOWN amount, and use the REAL number, never a guess: (a) a SKILL option — copy the "credits" the skill_* tool hands you VERBATIM; it is the metered average cost of that skill's recent runs (often tens of credits — do NOT downgrade it to a flat "1/4/10"); (b) a PAID commit item — its own per-item cost. Advancing to a new STAGE that fires several skills = the SUM of those skills' real credits. For an ordinary conversational / research reply the spend is variable and the founder is shown the ACTUAL credits under the message after the turn, so do NOT pre-quote a fictional "≈1" — omit "credits" on those. Omit "credits" entirely for pure-navigation options that run nothing (skip, stop, go back, "remind me later").
  OPTIONAL "skill_id" — set it on an option to make picking that option RUN that chat skill in real time (one click, no separate card). This is how you propose a skill: the skill_* tool hands you a ready-to-paste option object with "skill_id" + "credits" already set; drop it into options[]. ALWAYS pair "skill_id" with "credits". Only set "skill_id" when the skill's prerequisites are met (see TIER 0.5 — never offer startup-scoring/scoring/modeling skills while the idea canvas has no solution/value_proposition).
insight-card: :::artifact{"type":"insight-card","id":"ins_ID"}\n{"category":"market","title":"...","body":"...","confidence":"high","sources":[...]}\n:::
action-suggestion: :::artifact{"type":"action-suggestion","id":"act_ID"}\n{"title":"...","description":"...","action_label":"Go","action_type":"research","sources":[...]}\n:::
task: :::artifact{"type":"task","id":"task_ID"}\n{"title":"...","description":"...","priority":"high","due":"by Friday"}\n:::  (sources optional)
  When the founder asks to remember/track/do something, prefer the create_task TOOL over emitting the artifact directly.
workflow-card: :::artifact{"type":"workflow-card","id":"wf_ID"}\n{"title":"...","category":"marketing","description":"...","priority":"high","steps":["1","2","3"],"sources":[...]}\n:::
comparison-table: :::artifact{"type":"comparison-table","id":"cmp_ID"}\n{"title":"...","columns":["A","B"],"rows":[{"label":"Row1","values":["val1","val2"]}],"sources":[...]}\n:::
persona-card: :::artifact{"type":"persona-card","id":"per_ID"}\n{"name":"...","archetype":"customer|investor|expert|competitor","demographics":"...","jobs_to_be_done":["..."],"pains":["..."],"channels":["..."],"reaction":"...","engagement_score":8,"quote":"...","sources":[...]}\n:::
risk-matrix: :::artifact{"type":"risk-matrix","id":"rm_ID"}\n{"title":"...","overall_assessment":"...","risks":[{"id":"risk_001","dimension":"market|technical|regulatory|team|financial|dependency","risk":"1-line desc","probability":1-5,"impact":1-5,"risk_score":1-25,"severity":"critical|high|medium|low","narrative":"...","mitigation":"...","mitigation_owner":"...","status":"new|in_progress|mitigated"}],"sources":[...]}\n:::
idea-canvas: :::artifact{"type":"idea-canvas","id":"ic_ID"}\n{"title":"...","problem":"...","solution":"...","target_market":"...","value_proposition":"...","competitive_advantage":"...","unfair_advantage":"...","business_model":"...","key_metrics":["..."],"revenue_streams":["..."],"cost_structure":["..."]}\n:::  (sources optional — founder's own canvas)
tam-sam-som: :::artifact{"type":"tam-sam-som","id":"tss_ID"}\n{"title":"...","tam":{"value":"$24B","numeric_usd":24000000000,"methodology":"...","confidence":"medium"},"sam":{"value":"$3B","numeric_usd":3000000000},"som":{"value":"$80M","numeric_usd":80000000},"timeframe":"3 years","market_share_implied":"2.5%","sources":[...]}\n:::
investor-pipeline: :::artifact{"type":"investor-pipeline","id":"ip_ID"}\n{"title":"...","round_type":"Seed","round_target":1500000,"target_close":"2026-09-30","investors":[{"id":"inv_001","name":"...","type":"VC|angel","stage":"target|contacted|meeting|interested|committed|passed","check_size":500000,"next_step":"...","next_step_date":"..."}]}\n:::  (sources optional)
weekly-update: :::artifact{"type":"weekly-update","id":"wu_ID"}\n{"title":"Week X","period":"...","morale":7,"generated_summary":"...","metrics_snapshot":[{"label":"MRR","value":"$3.2k","delta":"+12%"}],"highlights":["..."],"challenges":["..."],"asks":["..."]}\n:::  (sources optional; only emit when founder explicitly asks for a weekly/period update)

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
6) comparison-table for GENERIC side-by-side comparison (pricing tiers, vendor selection, feature matrices). NOT for the specialized data shapes listed in rule 11.
7) option-set is MANDATORY on every response. When conversational, options MUST be direct, committable answers to the question asked — closed choices that take effect on click, NEVER process/meta pickers ("start with X", "all at once") or "now you type it" prompts (see OPTION-SET DISCIPLINE / CLOSED CHOICES). If the answer can only be the founder's own free text and you have no candidate to draft, ask in prose — do not fake option buttons.
   Option labels MUST be ≤ 6 words and verb-first ("Run market research", "Log an interview"); ALL rationale, context, and qualifiers go in the option's "description" field — never in the label.
8) entity-card for EVERY entity (competitor, technology, market segment) — but NOT for personas (use persona-card) or risks (use risk-matrix for 2+).
9) workflow-card for concrete multi-step action plans
10) Be proactive — use tools to research, browse web, challenge assumptions
11) SPECIALIZED CARDS — pick these over comparison-table/document/score-badges when the data shape matches:
    - 2+ risks with probability/impact → risk-matrix (NEVER comparison-table, even if the founder uses words like "matrix" or "table")
    - Personas (buyer or simulation) → persona-card (NEVER entity-card with entity_type="persona")
    - TAM/SAM/SOM or market sizing → tam-sam-som (NEVER three score-badges or a comparison-table). Whenever you state a sizing figure, carry it IN a tam-sam-som artifact — never prose-only numbers. The artifact is what persists the figure to the project (research.market_size) so it comes back in [RESEARCH CONTEXT] and you quote ONE consistent number next turn; a number mentioned only in prose is forgotten, and you will contradict yourself when asked again.
    - Lean Canvas / Idea Canvas / 9-block business model → idea-canvas (NEVER a document)
    - Fundraising pipeline / investors grouped by stage → investor-pipeline (NEVER comparison-table)
    - Weekly/period founder update with highlights/challenges/asks → weekly-update (ONLY when explicitly asked)
    The user has invested in custom visualizations for these specific data shapes. Using comparison-table for risk audits or market sizing is a routing miss.
12) DIRECTIONAL vs OFFICIAL — be honest about what is saved. A readiness score (gauge-chart/score-card) or a financial projection (bar-chart/metric-grid) you produce inline is a DIRECTIONAL read, NOT the project's official record: the validated score comes from the scoring skill (-> scores) and the official projection from the financial model (-> the Financials page). NEVER imply a chat-emitted score/projection is "saved", "recorded", "locked in", or "established" — call it a directional read and offer the skill/model to make it official. (A price the founder commits via set_pricing IS persisted and may be called locked in — that's the anchor_price, which the financial model now reads.)

=== TIER 5 — TRIGGERED PROTOCOLS (activated by specific contexts) ===

WATCHER PROPOSALS — DERISKING PROTOCOL:
A watcher is a SENSOR on ONE named risk. Two implementation flavors, one founder-facing concept:
  - propose_monitor (Topic flavor — LLM scan) when the founder names a TOPIC to watch ("competitor pricing moves", "regulatory shifts in EU AI act"). Requires linked_risk_id from risk_audit or a verbatim founder quote.
  - propose_watch_source (URL flavor — URL diff) when the founder names SPECIFIC URLs ("watch HubSpot's pricing page", "track this competitor's blog"). Cheaper, deterministic.
Pick the flavor by what the founder gave you: explicit URLs → URL flavor; topical area → Topic flavor.

PROPOSE VIA THE TOOL, NEVER IN PROSE. A watcher proposal MUST be the structured artifact the propose_monitor / propose_watch_source tool emits — a clean in-chat CARD showing the watcher's TITLE (name), CADENCE (daily/weekly), and AIM (objective: the one risk it derisks + what it watches for). NEVER hand-write a watcher as a prose block (no "Watcher: X / Topic: … / Alert threshold: … / Linked assumption: …" walls). Describing a watcher in prose instead of calling the tool is BROKEN — the founder can't approve prose, and it won't get created. Your visible reply = ONE sentence naming the watcher + WHY, then the tool's card, then your trailing option-set.

CREATE-ON-CONFIRM: the card is a PROPOSAL only. The watcher is created (with its full extended scan-prompt instructions) when the founder APPROVES it in the watcher inbox/card — not when you describe it. So set the title/cadence/objective precisely; that's what gets persisted on approval.

ASK WHEN UNCLEAR — DON'T GUESS. If you can't specify the watcher confidently — cadence ambiguous, scope too broad, no clear linked risk, or you're unsure exactly what should trigger an alert — DO NOT emit a half-specified card. Instead ask the founder ONE crisp clarifying question via your trailing option-set (e.g. "Daily or weekly?", "Watch just HelloFresh, or all three meal-kit incumbents?"). Each such option still carries its "credits" estimate. A vague card is worse than a question.

In prose to the founder, ALWAYS call them "watchers" — never "monitors" or "watch sources". The UI shows one list of watchers with a "Topic" or "URL" pill; agent language should match.

VALIDATION GATE — NOTHING TURNS A SPINE STEP GREEN WITHOUT THE FOUNDER'S YES:
The 7-stage spine is the founder's VALIDATED truth, so any evidence that would satisfy a validation substep MUST be staged for approval — you can NEVER write it silently. The gated writes and their tools:
  - Canvas fields (problem / solution / target market / value prop / competitive edge) → update_idea_canvas (it now PROPOSES a card, it does not write directly) OR propose_validation.
  - Competitors mapped (Stage 2) → propose_validation, kind="competitor" (one item per competitor, with its name).
  - Market size / TAM established (Stage 2) → propose_validation, kind="market_size_fact".
BATCH everything from THIS turn into ONE propose_validation call (one card): if you set canvas fields AND mapped competitors AND sized the market in the same turn, that is ONE card with all items — never three cards, and never split "free" canvas items from "paid" knowledge items into two cards (the card already shows per-item cost and a combined total). Give each item its sources[] (provenance powers the proof the founder sees when they later click the validated step). Emit the tool's returned artifact block VERBATIM so the inline approval card renders. The founder reviews, removes/edits items, and applies — only then does the substep go green.
Do NOT write a prose lead-in or header before the card — no "Apply your canvas fields (free):" or "Apply competitors + market size (${KNOWLEDGE_APPLY_CREDITS * 3} credits):" stubs. The card is fully self-describing: it has a "Validate evidence" header, each item's cost, and Apply/Skip buttons that state the total ("Apply 3 items · free", "Apply 3 items · ${KNOWLEDGE_APPLY_CREDITS * 3} cr"). A colon-terminated "Apply …:" line with the real content in the card below reads as broken, duplicated UI. At most one short sentence of context, then the card — never a label stub.
Display artifacts (tam-sam-som, comparison-table, persona-card) are still fine to help DISCUSS, but they do NOT commit to the spine — the commit always goes through the gate. Generic context that doesn't move any substep keeps going to save_memory_fact, not the gate.

When founder expresses concern about a specific external force:
1. Risk in risk_audit? → propose the watcher tied to that risk (Topic flavor with linked_risk_id, or URL flavor with the same risk_id in linked_quote)
2. Vague concern? → PUSH BACK for specificity before proposing
3. Existing watcher covers it? → reference it, don't duplicate
4. Cap reached? → surface pause candidates
Pass the one-sentence test: "This watcher fires when <linked_risk_id> is materializing, because it detects <alert_threshold>."
A good watcher derisks ONE thing. Prefer ZERO watchers over a vague one — BUT Stage 2 (Market Validation) requires at least one. If the [WATCHER GAP] signal is present (the project has no active watcher) and you have a concrete competitor or named risk to point it at, proactively propose ONE precise watcher this turn rather than waiting for the founder to ask.

BUDGET CAP CHANGES:
Call propose_budget_change when the founder explicitly asks to raise/lower cap, or when credits-empty and they want to continue. Cite the founder quote or error in sources. Never bump silently.

DISMISSING INBOX ITEMS:
When the founder wants to remove/clear/replace queued proposals (e.g. duplicate watcher cards), handle it IN CHAT — do NOT tell them to "go to your inbox and dismiss it." You have dismiss_pending_actions for this. Flow: (1) call list_pending_actions to get the exact ids + titles, (2) in your reply show precisely what will be dismissed and end with a confirm/cancel option-set ("Yes, dismiss these N" / "Keep them"), (3) ONLY after the founder picks confirm, call dismiss_pending_actions with those ids. Never dismiss without that explicit confirm step; dismissal isn't undoable from chat. After a successful dismiss, if they wanted a replacement watcher, propose the ONE clean watcher right away via its monitor card.

SKILL TOOL GUARD:
Skill tools produce DURABLE validation evidence (skill_completions row, section_scores update, idea_canvas/risk_audit/etc. updates). Web_search produces ephemeral prose. When the founder's question maps to a registered skill per TIER 0.5 content-mapping (topical match — no explicit trigger phrase required), FIRE the skill — do not "offer" via option-set. Option-sets exist for choices BETWEEN skills when multiple match, not to ask permission to fire one.

Exception — offer (don't fire) ONLY when: (a) the founder's question genuinely matches MULTIPLE skills and they must pick, or (b) all 7 stages are verdict GO+ and you're in operating mode.

For keyword-adjacent questions that do NOT map to a registered skill (e.g., "what are the biggest risks today?" without any risk_audit context yet), answer from get_risk_audit + list_intelligence_briefs + list_ecosystem_alerts.

Most common failure mode: "agent offered skill_X as one of 4 options, founder didn't click, stage stayed at 0%, no skill_completions row ever landed." Don't do that — fire the skill.

SOLVE FLOW MODE:
Triggered by "Start the Solve flow" / "Avvia il flusso Solve".
The Solve flow walks the founder through the 7-stage validation pipeline IN ORDER.
Each stage has 1-2 skills (see get_project_summary → Stage readiness).

Progression rules:
1. Before each Solve step, call get_project_summary to read next_recommended_skill.
   Run THAT skill — do not pick a different one.
2. Follow the 7-stage order: Idea Validation → Market Validation → Persona
   → Business Model → Build & Launch → Fundraise → Operate.
3. Within a stage, respect SKILL_SOURCES dependencies (e.g., startup-scoring before
   business-model, idea-shaping before startup-scoring).
4. After each skill completes, emit/update a solve-progress artifact (id "solve_1")
   showing completed stages and next step.
5. The founder can skip any stage — when they say "skip", move to the next stage.
6. Reuse fresh data (< 7 days) — don't re-run a skill if it completed recently.
7. Always end each stage with an option-set: continue to next stage, skip, or stop.]

`;

export async function POST(request: NextRequest) {
  await ensureToolsJsonColumn();

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

  // Rate limit: 10 burst, ~30/min sustained (0.5 tokens/sec refill)
  const rl = checkRateLimit(`chat:${userId}`, 10, 0.5);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ success: false, error: 'Too many requests. Please slow down.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rl.retryAfterSeconds ?? 2),
        },
      },
    );
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

  const projects = await query<{ id: string; name: string; description: string; current_step: number; settings: { rich_context?: boolean } | null }>(
    'SELECT id, name, description, current_step, settings FROM projects WHERE id = ?', project_id
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

  // HARD-STOP gate (Phase 1) — runs BEFORE the SSE stream opens so the client
  // gets a clean JSON 402 (not a half-opened event-stream). No-op unless
  // CREDITS_HARD_STOP is on AND the user is out of credits AND not exempt
  // (CREDITS_EXEMPT_USER_IDS). The recharge dialog opens off this body.
  const gate = await assertCreditsAvailable(userId);
  if (!gate.allowed) {
    console.info(`[chat] user ${userId} out of credits — blocking (hard-stop on)`);
    return new Response(
      JSON.stringify({ success: false, error: 'out_of_credits', credits_remaining: gate.remaining }),
      { status: 402, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const lastMessage = messages[messages.length - 1]?.content || '';
  const projectContext = `[PROJECT: "${projects[0].name}"${projects[0].description ? ` — ${projects[0].description}` : ''}]\n`;

  // Memory context — curated facts + recent events + graph summary + completed
  // skills — lets the agent remember across sessions AND across chat "steps"
  // within a project (see sessionId change below).
  const memoryContext = await buildMemoryContext(userId, project_id, {
    enriched: projects[0].settings?.rich_context === true,
  });

  // Stage context — the founder's active journey stage with passed/missing
  // evidence checks. Lets the agent anchor every reply to closing real gaps
  // rather than reacting to whatever the founder happens to type. Tolerant:
  // if the snapshot fails (missing tables on a fresh project), we skip the
  // block entirely — better than a 500.
  // Build the journey snapshot ONCE per turn and reuse it for both stage
  // context and the direction engine (was built twice — 32 queries — before).
  let snapshot: Awaited<ReturnType<typeof buildProjectSnapshot>> | null = null;
  let stageContext = '';
  try {
    snapshot = await buildProjectSnapshot(project_id);
    stageContext = formatStageContextForPrompt(snapshot);
  } catch {
    /* journey snapshot failed — chat still works, just without stage framing */
  }

  // Derive stage facts from the snapshot we ALREADY built — the single source of
  // truth, never the legacy projects.current_step column (a retired 5-stage
  // pointer that drifts from the spine). Defaults assume "still in the journey"
  // when the snapshot is unavailable, so all skills stay exposed.
  let activeStageNumber = 1;
  let allStagesDone = false;
  if (snapshot) {
    const evals = evaluateAllStages(snapshot);
    activeStageNumber = activeStage(evals).stage.number;
    allStagesDone = evals.every((e) => e.status === 'done');
  }

  // Inject the LIVE idea-canvas state every turn so the agent never forgets what
  // the founder already defined — even when a long refine conversation pushes it
  // out of the message-history window. (Confirmed failure: the agent re-asked
  // "weren't we talking about unfair advantage?" and the founder had to paste the
  // value proposition back in.)
  let canvasContext = '';
  if (snapshot?.idea_canvas) {
    const c = snapshot.idea_canvas as Record<string, unknown>;
    const fields: Array<[string, unknown]> = [
      ['Problem', c.problem],
      ['Solution', c.solution],
      ['Target market', c.target_market],
      ['Value proposition', c.value_proposition],
      ['Competitive advantage', c.competitive_advantage],
    ];
    const filled = fields.filter(([, v]) => typeof v === 'string' && v.trim().length > 0);
    if (filled.length > 0) {
      canvasContext = [
        '[CURRENT IDEA CANVAS — already defined by the founder; reference these, never re-ask for them]',
        ...filled.map(([k, v]) => `- ${k}: ${String(v).trim()}`),
        'When the founder challenges or refines one of these fields, iterate on the TEXT directly in your reply and, once they settle on the wording, commit it via a commit option (see COMMIT VIA A DETERMINISTIC COMMIT OPTION). Do NOT re-ask for information shown here, and do NOT propose a skill to do what is a simple text refinement.',
        '',
      ].join('\n');
    }
  }

  // [COMMIT GUARD] (Layer 2) The model sometimes NARRATES a commit ("committed",
  // "added the competitor") without persisting it — prose is not persistence, so
  // the canvas/graph stays empty. The deterministic commit option fixes the CLICK
  // path; this catches the rest (e.g. the founder TYPED a value the model then
  // only "saved" in words). Two checks, both best-effort, never blocking:
  //   (a) CANVAS — claimed a canvas commit, yet a core field is still missing
  //       from the live snapshot.
  //   (b) PAID  — claimed a competitor / market-size commit, yet the previous
  //       message carried NO commit affordance. A REAL commit always leaves an
  //       affordance (a commit option, or a validation / entity / comparison
  //       card); pure prose with none is the silent drop. This can't false-fire
  //       on a legitimate commit (that one had an affordance); the only stray
  //       fire — re-stating a commit a turn after a real click — is harmless
  //       because the nudge is self-correcting ("if already saved, continue").
  let commitGuardContext = '';
  if (snapshot && !allStagesDone) {
    try {
      const prevRows = await query<{ content: string }>(
        "SELECT content FROM chat_messages WHERE project_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1",
        project_id,
      );
      const prev = prevRows[0]?.content ?? '';
      const guards: string[] = [];

      // (a) Canvas claim with a core field still missing from the live canvas.
      const ic = (snapshot.idea_canvas ?? {}) as Record<string, unknown>;
      const hasField = (k: string) => typeof ic[k] === 'string' && (ic[k] as string).trim().length > 0;
      const coreMissing = !(hasField('problem') && hasField('solution') && hasField('value_proposition'));
      const claimedCanvasCommit = /(committed|locked in|saved to (?:your )?canvas|added to (?:your )?canvas|registrat\w+ nel canvas|salvat\w+ nel canvas|aggiornat\w+ il canvas|inserit\w+ nel canvas|bloccat\w+ (?:nel|sul) canvas)/i.test(prev);
      if (coreMissing && claimedCanvasCommit) {
        guards.push('A canvas field is saved ONLY when the founder clicks a commit option carrying "commit":{"canvas":{...}}. A core field you claimed is still MISSING from [CURRENT IDEA CANVAS] above — present that commit option NOW carrying its exact value, and do not claim it is saved.');
      }

      // (b) Paid-item claim WITHOUT a commit affordance in the same message.
      const claimedPaidCommit =
        /(added|saved|recorded|logged|captured|aggiunt\w+|salvat\w+|registrat\w+|inserit\w+)[^.\n]{0,40}(competitors?|to (?:your )?graph|to (?:your )?intelligence|market siz\w*|TAM\b|al grafo|all'intelligence|dimension\w+ di mercato)/i.test(prev)
        || /(competitors?|market siz\w*)[^.\n]{0,40}(added|saved|recorded|logged|aggiunt\w+|salvat\w+|registrat\w+)/i.test(prev);
      const hadAffordance =
        /"commit"\s*:/.test(prev)
        || /"type"\s*:\s*"(validation-proposal|entity-card|comparison-table|knowledge-suggestion)"/.test(prev);
      if (claimedPaidCommit && !hadAffordance) {
        guards.push('You appear to have claimed a competitor / market-size commit, but your previous message carried NO commit affordance. Competitors and market size are saved ONLY via a commit option carrying "commit":{"items":[…]} (or an applied card). If you said you added one without that option, it was NOT saved — emit the commit option NOW. If it is already in the graph/knowledge, simply continue.');
      }

      if (guards.length > 0) {
        commitGuardContext = ['[COMMIT GUARD] Prose is NOT persistence — evidence lands only when the founder clicks a commit affordance.', ...guards, ''].join('\n');
      }
    } catch { /* commit guard is best-effort — never block the turn */ }
  }

  // Watcher gap: Stage 2 needs ≥1 active watcher and this project has none.
  // Surface it so the agent proactively proposes one (and enable the write tool
  // below). Confirmed gap: agents almost never call propose_monitor unprompted.
  // ALSO fire when the founder EXPLICITLY asks to watch/monitor something this
  // turn, regardless of stage — otherwise picking "Watch competitor moves" at
  // Stage 1 left the agent un-nudged and it replied with only generic options
  // instead of the monitor card.
  const activeWatchers =
    (snapshot?.monitors ?? []).filter((m) => m.status === 'active').length +
    (snapshot?.watch_sources ?? []).filter((w) => w.status === 'active').length;
  // No trailing \b on the verb stems — \bwatch\b would MISS the plural
  // "watchers"/"monitors" (the user's actual phrasing). Prefix-match instead so
  // watch/watcher/watchers/watching, monitor/monitors, track/tracking all hit.
  const watcherIntent = /(\bwatch|\bmonitor|\btrack|keep an eye|alert me|notify me)/i.test(lastMessage);
  // watcherIntent always fires the nudge (founder explicitly asked), regardless
  // of how many watchers already exist — they can run several distinct ones.
  const needsWatcher =
    !!snapshot && !allStagesDone && (watcherIntent || (activeStageNumber >= 2 && activeWatchers === 0));
  const watcherContext = needsWatcher
    ? [
        watcherIntent
          ? '[WATCHER REQUESTED] The founder just asked to watch/monitor something. Deliver a real monitor card THIS turn via propose_monitor (or propose_watch_source for specific URLs), linked_risk_id="ad_hoc" + linked_quote = the founder\'s own words. Do NOT reply with only generic prompts — the card IS the deliverable. Propose exactly ONE watcher for THIS request (if several competitors are named, fold them into that single watcher\'s urls_to_track / query — never one-per-competitor). Multiple DISTINCT watchers may coexist in the inbox — NEVER tell the founder to dismiss or apply an existing pending watcher just to make room; simply propose the new one alongside whatever is already pending.'
          : '[WATCHER GAP] Stage 2 (Market Validation) needs at least ONE active watcher and this project has none.',
        'Propose ONE precise watcher for the request — never vague, at most one per turn (distinct watchers from other turns stay as they are). One sentence naming it + why, then the tool card, then your trailing option-set.',
        '',
      ].join('\n')
    : '';

  // WS-A — inject the direction engine's computed next-best-action so the model
  // LEADS with the deterministic next move instead of re-deriving it (or
  // forgetting to call get_project_summary). Tolerant: any failure degrades to
  // no injected direction — chat still works. lastChatAt drives the
  // "what changed since last time" signal feed (route.ts:143 freshness rule).
  let directionContext = '';
  try {
    const lastRows = await query<{ created_at: string }>(
      'SELECT created_at FROM chat_messages WHERE project_id = ? ORDER BY created_at DESC LIMIT 1',
      project_id,
    );
    const lastChatAt = lastRows[0]?.created_at ?? null;
    const nba = await computeNextBestAction(project_id, { lastChatAt, snapshot: snapshot ?? undefined });
    directionContext = `${renderDirectionForPrompt(nba)}\n\n`;
  } catch {
    /* direction engine failed — chat still works without injected next-best-action */
  }

  // Build system prompt: SOUL + AGENTS personality first (locale-aware),
  // then ARTIFACT_INSTRUCTIONS, then stage context (highest signal for
  // "what to talk about"), then per-project context + memory + recently-
  // completed skill summaries.
  // Account-wide language wins (users.locale), falling back to the project's
  // legacy locale, then English — see src/lib/i18n/resolve-locale.ts.
  const locale = await resolveLocale(userId, project_id);
  const skillContext = await buildCompletedSkillContext(project_id, lastMessage);
  // Turn-level language reinforcement (item 4): the static prefix already carries
  // languageDirective(), but on a short option-select turn the model drifts to
  // English. Re-stating it at the END of the dynamic context (recency-weighted,
  // fresh every turn) keeps Italian sticky even when the founder clicks an option.
  const localeReminder =
    locale !== 'en'
      ? `\n\n[LANGUAGE — THIS TURN] Reply in ${LOCALE_ENGLISH_NAME[locale]} — every founder-facing word, including artifact prose. This holds even when the founder's message is short, an option label, English, or a single word. Do NOT switch to English.`
      : '';
  // Lever 1 (CACHE_PREFIX_SPLIT): keep the system prompt's static prefix
  // byte-stable so Anthropic caches it as a READ instead of re-writing ~17k tok
  // every turn. The dynamic per-turn context is assembled here but, when the flag
  // is ON, is NOT baked into the system string — it rides the user turn instead
  // (buildSplitUserTurn, below), recency-preserving. Flag OFF = byte-identical to before.
  // Committed market sizing (TAM/SAM/SOM) so the agent reuses one figure across
  // turns instead of re-deriving a different number each time. snapshot.research
  // is already fetched; '' when no sizing exists (no token cost). Reference-only
  // framing keeps it out of the validation gate.
  const researchContext = buildResearchContext((snapshot?.research ?? null) as Record<string, unknown> | null);
  const dynamicContext = `${directionContext}${stageContext}${canvasContext}${researchContext}${commitGuardContext}${watcherContext}${projectContext}${memoryContext}\n${skillContext}${localeReminder}`;
  let systemPrompt = buildSystemPromptString({
    locale,
    context: 'chat',
    tail: ARTIFACT_INSTRUCTIONS,
    projectContext: CACHE_PREFIX_SPLIT ? '' : dynamicContext,
  });
  // Per-turn steering (prereq gate + prior-turn nudge) accumulates here. Legacy
  // folds it into systemPrompt (byte-identical to before); split rides it on the
  // user turn AFTER the context (so the nudges keep their read-recency).
  let trailingSteer = '';
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
    // Write tools attach on turn 1, on explicit write intent, OR when there's an
    // open watcher gap — otherwise the agent literally can't call propose_monitor
    // on the advisory turn where it should proactively offer a watcher.
    const includeWriteTools = messages.length <= 1 || hasWriteIntent(lastMessage) || needsWatcher;
    const projectTools = makeProjectTools(project_id, { includeWriteTools, userId });

    // Route simple follow-ups to Haiku (~80% cheaper) — "yes", "go ahead",
    // "tell me more", etc. don't need Sonnet's multi-tool reasoning depth.
    const chatTask: TaskLabel = isSimpleFollowUp(lastMessage, messages)
      ? 'chat-followup'
      : 'chat';

    // Solve flow activates implicitly for any project that hasn't completed
    // all 7 validation stages. All skills are exposed so the system prompt's
    // get_project_summary → next_recommended_skill ordering works. Once the
    // pipeline is done (step 7), switch to classifier-filtered free-form chat.
    const isSolveFlow = !allStagesDone;

    const allSkillTools = getSkillTools({ userId, projectId: project_id });

    let skillTools: typeof allSkillTools;
    if (chatTask === 'chat-followup') {
      // Simple follow-ups ("yes", "go ahead") never trigger skill invocations.
      // Skip the Haiku classifier call entirely to save ~$0.0006 + 300ms.
      skillTools = [];
    } else if (isSolveFlow) {
      // Solve flow: all skills available — system prompt mandates
      // get_project_summary → next_recommended_skill for ordering.
      skillTools = allSkillTools;
    } else {
      // Free-form chat: Haiku classifier picks top 3 relevant skills.
      const skillManifest = listSkillManifest();
      const relevantManifest = await rankSkillsForQuery(
        lastMessage,
        {
          id: project_id,
          name: projects[0].name,
          description: projects[0].description || '',
          stageNumber: activeStageNumber,
        },
        skillManifest,
        { topN: 3 },
      );
      const relevantIds = new Set(relevantManifest.map((s) => s.id));
      skillTools = allSkillTools.filter((t) => {
        const id = t.name.replace(/^skill_/, '').replace(/_/g, '-');
        return relevantIds.has(id);
      });
    }

    // PREREQUISITE gate (proposal-time) — the deterministic twin of the run-time
    // 422 in /skills. When the idea canvas has no solution/value_proposition,
    // REMOVE every canvas-dependent scoring/modeling/build skill tool so the
    // agent can't even PROPOSE one it couldn't run (the prompt rule alone gets
    // ignored — the agent kept offering startup-scoring on a bare canvas). A
    // matching system-prompt note steers it to sketch the solution instead of
    // silently dropping the option. idea-shaping/market-research/startup-advisor
    // survive — they're how the founder FILLS the canvas.
    if (skillTools.length > 0 && (await canvasLacksCorePrereqs(project_id))) {
      const before = skillTools.length;
      skillTools = skillTools.filter((t) => {
        const id = t.name.replace(/^skill_/, '').replace(/_/g, '-');
        return !isCanvasDependentSkill(id);
      });
      if (skillTools.length < before) {
        trailingSteer += `\n\n[PREREQUISITE GATE] This project's idea canvas has no solution and/or value proposition yet, so scoring/modeling/build skills (startup-scoring, business-model, simulation, pitch, landing-page, etc.) are UNAVAILABLE this turn and you cannot run them. Do NOT propose them or put their skill_id in any option — they would be rejected. Instead, steer the founder to sketch the solution + value proposition first (offer a canvas-commit option, or idea-shaping), then those skills unlock.`;
      }
    }

    // Iteration-3 WS-A — inject TIER 0.5 nudges based on PRIOR turn violations.
    // chat-followup (Haiku, skillTools = []) is exempt by construction; the
    // violations can't happen on a path that has no skill tools to misuse.
    // Pre-migration safety: meta column may not exist yet → query catches and
    // returns no nudge. Chat keeps functioning either way.
    if (chatTask === 'chat') {
      try {
        const priorRows = await query<{ meta: unknown }>(
          `SELECT meta FROM chat_messages
            WHERE project_id = ? AND role = 'assistant'
            ORDER BY "timestamp" DESC LIMIT 1`,
          project_id,
        );
        const meta = priorRows[0]?.meta;
        if (meta && typeof meta === 'object') {
          const prior: TurnViolations = {
            skill_first_violation: !!(meta as Record<string, unknown>).skill_first_violation,
            prose_fabrication: !!(meta as Record<string, unknown>).prose_fabrication,
          };
          const nudge = renderNudgeForNextTurn(prior);
          if (nudge) trailingSteer += `\n\n${nudge}`;
        }
      } catch (err) {
        // meta column missing (pre-migration) OR transient DB error.
        // Non-fatal — the nudge is a quality improvement, not a correctness
        // gate, and TIER 0.5 prompt rules still apply.
        console.warn('[chat] prior-turn nudge query failed (non-fatal):', (err as Error).message);
      }
    }

    // Durable history seed (cold-start fix). The client re-sends the full
    // thread every turn; mirror all-but-the-current-message into the agent so
    // a wiped ephemeral session.jsonl (cold start / deploy) no longer makes the
    // agent "restart from scratch" mid-conversation. Excludes the last entry —
    // that's `lastMessage`, which the SDK appends as the new user turn.
    const seedHistory = buildSeedHistory(messages.slice(0, -1));

    // Lever 1 assembly. Legacy: fold steering into the system string (byte-
    // identical to before). Split: leave systemPrompt as the static cacheable
    // prefix and carry dynamic context + steering on the user turn (steering last
    // → recency preserved). Same total content reaches the model either way.
    let effectiveLastMessage = lastMessage;
    if (CACHE_PREFIX_SPLIT) {
      effectiveLastMessage = buildSplitUserTurn(dynamicContext, trailingSteer, lastMessage);
    } else {
      systemPrompt = systemPrompt + trailingSteer;
    }

    const { stream: piStream } = runAgentStream(effectiveLastMessage, {
      sessionId,
      systemPrompt,
      seedHistory,
      extraTools: [...projectTools, ...skillTools],
      // 180s — generous for research-heavy turns but cuts off the
      // agent-stuck-in-loop case (observed turns hanging to 10+ min with
      // empty SSE streams). pi-agent.ts force-closes the SSE controller at
      // this deadline regardless of whether agent.abort() propagates.
      timeout: 180000,
      task: chatTask,
      // Slightly wider than the 12-message default: a deep single-field refine
      // (e.g. iterating on the value proposition) otherwise pushes the agreed
      // wording out of context and the agent re-asks. The [CURRENT IDEA CANVAS]
      // block carries the durable state; this just keeps the conversational
      // thread coherent, at a small token cost.
      maxHistoryMessages: 16,
    });

    // Accumulate response text so we can: (1) extract agent-emitted facts via
    // :::artifact{type="fact"} blocks, (2) write a chat_turn memory_event with
    // a meaningful preview, (3) fuel later telemetry.
    let fullResponse = '';
    // Captured from the SSE `done` event emitted by runAgentStream on agent_end.
    let streamUsage: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      total_tokens?: number;
      cost?: number;
    } | undefined;
    const decoder = new TextDecoder();
    // SSE line buffer: accumulates partial lines across chunk boundaries so
    // that a `data: {...}` line split across two TCP chunks still parses.
    let lineBuffer = '';
    // Tool activity accumulated from tool_start/tool_end SSE events.
    let toolsList: Array<{ id: string; name: string; args?: unknown; status: string }> = [];

    // Wrap to add telemetry + memory hooks on completion
    const telemetryStream = piStream.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        // chunk is the raw SSE event buffer; decode + peek at JSON deltas
        try {
          const text = decoder.decode(chunk, { stream: true });
          lineBuffer += text;
          const lines = lineBuffer.split('\n');
          // Last element is either '' (line ended with \n) or a partial line;
          // keep it in the buffer for the next chunk.
          lineBuffer = lines.pop() ?? '';
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
                // Capture tool activity for persistence
                if (payload.tool_start) {
                  toolsList.push({
                    id: payload.tool_start.id,
                    name: payload.tool_start.name,
                    args: payload.tool_start.args,
                    status: 'done',
                  });
                }
                if (payload.tool_end) {
                  const t = toolsList.find((x) => x.id === payload.tool_end.id);
                  if (t) t.status = payload.tool_end.error ? 'error' : 'done';
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
        // SAFETY: the flush hook does ~30 await calls (DB inserts for usage,
        // chat_messages, memory_events, facts, workflow_plans, artifact
        // persistence, plus Langfuse). If ANY one hangs (DB pool exhausted,
        // Langfuse blocked, slow query), flush never returns and the
        // TransformStream stays open — the client SSE reader blocks for
        // minutes (observed up to 25 min in e2e runs). Force-terminate after
        // 60s so the client reader unblocks even when DB/network is sick.
        // The harness's 240s client abort + pi-agent's 180s timer would
        // never have kicked in because the AGENT did finish — only the
        // POST-agent persistence hung. This is the missing safety net.
        const flushDeadline = setTimeout(() => {
          console.warn('[chat] flush hook exceeded 60s — force-terminating stream');
          try { controller.terminate(); } catch { /* already done */ }
        }, 60_000);
        try {
        const latencyMs = Date.now() - piStart;
        // Pull the actual provider+model from the router so the logged slug
        // reflects reality (direct Anthropic vs OpenRouter). Falls back to
        // PI_PROVIDER/PI_MODEL env vars for call sites without a task label.
        const picked = pickModel(chatTask);
        const piProvider = picked.provider;
        const piModel = picked.model;
        const usage = {
          input_tokens: streamUsage?.input_tokens ?? 0,
          output_tokens: streamUsage?.output_tokens ?? 0,
          cache_creation_input_tokens: streamUsage?.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: streamUsage?.cache_read_input_tokens ?? 0,
        };
        const cost = streamUsage?.cost ?? estimateCost(piProvider, piModel, usage);
        await logUsageToDb(project_id, null, step, piProvider, piModel, usage, cost, latencyMs);
        const langfuseTraceId = logToLangfuse(
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
          // Two rows per turn: the assistant MUST sort after its user prompt.
          // Give them distinct, ordered timestamps (user `now`, assistant +1ms)
          // so the persisted order is correct on its own — the history GET also
          // carries a role tiebreaker as a safety net for any residual ties.
          const now = new Date().toISOString();
          const assistantTs = new Date(new Date(now).getTime() + 1).toISOString();
          await run(
            `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
             VALUES (?, ?, ?, 'user', ?, ?, ?)`,
            `msg_${crypto.randomUUID().slice(0, 12)}`,
            project_id, step, lastMessage, now, userId,
          );
          if (fullResponse.trim().length > 0) {
            const toolsJson = toolsList.length > 0 ? JSON.stringify(toolsList) : null;
            const citationsJson = extractCitations(fullResponse);
            // Iteration-3 WS-A — compute TIER 0.5 violation flags for this
            // turn. The next turn's nudge injection reads them from meta.
            // Pure + synchronous; no added latency over the existing INSERT.
            // Only persist meta when something fired — keeps the JSONB
            // surface clean and lets partial indexes stay sparse.
            let metaJson: string | null = null;
            try {
              const violations = analyzeTurnViolations(
                toolsList.map((t) => ({ name: t.name })),
                fullResponse,
                lastMessage,
              );
              if (violations.skill_first_violation || violations.prose_fabrication) {
                metaJson = JSON.stringify(violations);
              }
            } catch (err) {
              console.warn('[chat] turn-violation analysis failed (non-fatal):', err);
            }
            await run(
              `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id, tools_json, citations, langfuse_trace_id, meta)
               VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?)`,
              `msg_${crypto.randomUUID().slice(0, 12)}`,
              project_id, step, fullResponse, assistantTs, userId, toolsJson,
              citationsJson ?? null,
              langfuseTraceId,
              metaJson,
            );
          }
        } catch (err) {
          console.warn('[chat] chat_messages persist failed (non-fatal):', err);
        }

        // Collect artifact→persisted_id mappings so the done-event can
        // enrich client artifacts with server-assigned IDs for apply/reject.
        const persistedMap: Record<string, { persisted_id: string; reviewed_state: string }> = {};

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
          // Rescue path — log when an artifact passed validation only because
          // we attached the trailing <CITATIONS> block. Mirrors the rejection
          // event so prompt/observability can track "rescue rate" vs "rejection
          // rate" and tighten the prompt when too many artifacts need rescuing.
          const rescued = segments.filter(
            (s): s is Extract<typeof s, { type: 'artifact' }> =>
              s.type === 'artifact' && s.used_fallback_sources === true,
          );
          if (rescued.length > 0) {
            try {
              await recordEvent({
                userId,
                projectId: project_id,
                eventType: 'artifact_rescued_by_fallback_citations',
                payload: {
                  count: rescued.length,
                  rescues: rescued.map(r => ({ artifact_type: r.artifact.type })),
                },
              });
            } catch {
              // non-fatal — observability only
            }
          }

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
                const factId = await recordFact({
                  userId,
                  projectId: project_id,
                  fact: f.fact,
                  kind: f.kind ?? 'fact',
                  sourceType: 'chat',
                  // Carry the artifact's client id as the fact's source_id so
                  // Canvas Memory can back-link to the spawning card. Older
                  // facts without source_id render without the jump arrow.
                  sourceId: f.id,
                  confidence: f.confidence ?? 0.8,
                  // Knowledge-as-proposal: chat-surfaced facts no longer
                  // auto-apply. They persist 'pending' and surface in the Inbox
                  // until the founder applies (0.5 credits).
                  reviewedState: 'pending',
                });
                if (factId && f.id) {
                  persistedMap[f.id] = { persisted_id: factId, reviewed_state: 'pending' };
                }
              }
            } else if (seg.artifact.type === 'workflow-card') {
              // Persist the proposed workflow + expand into pending_actions
              // so the founder can apply/edit each step from the inbox.
              await captureWorkflow({
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
              // Collect persisted_id for the done-event artifact enrichment
              if (persistResult.persisted && persistResult.persisted_id && seg.artifact.id) {
                persistedMap[seg.artifact.id] = {
                  persisted_id: persistResult.persisted_id,
                  reviewed_state: 'pending',
                };
              }
            }
          }
        } catch (err) {
          console.warn('[chat] memory write failed (non-fatal):', err);
        }

        // Watcher-card backstop: make pending watchers ACTIONABLE in chat
        // (Apply/Dismiss), because (1) the agent often paraphrases instead of
        // pasting the :::artifact block, and (2) its sources lack the `title` the
        // strict parser requires → silent artifact-error → no card. Fire when the
        // agent used a watcher tool (show the new one) OR the founder asked about
        // watchers (show what's pending so they can act). Inject a card for each
        // pending watcher not already rendered in this response — covers BOTH
        // propose_monitor (configure_monitor → monitor-proposal) and
        // propose_watch_source (configure_watch_source → watch-source-proposal).
        // Live-only (persistence already ran → no double-create); each card
        // carries pending_action_id so Apply/Dismiss round-trip. Fully defensive.
        try {
          const calledWatcherTool = toolsList.some(
            (t) => t.name === 'propose_monitor' || t.name === 'propose_watch_source',
          );
          // Robust trigger: the user's spelling is unreliable ("wathcers" typo)
          // and the agent may cache instead of calling list_pending_actions — but
          // when the turn IS about watchers, the agent's OWN (correctly-spelled)
          // response mentions them. Trigger off that too. Cards only inject when
          // pending watchers actually exist, so over-triggering is low-harm and
          // self-limiting (apply them → none pending → nothing injects).
          const turnAboutWatchers =
            calledWatcherTool ||
            watcherIntent ||
            /(\bwatch|\bmonitor)/i.test(fullResponse);
          if (turnAboutWatchers) {
            const pendingWatchers = await query<{ id: string; action_type: string; payload: unknown }>(
              `SELECT id, action_type, payload FROM pending_actions
               WHERE project_id = ? AND action_type IN ('configure_monitor','configure_watch_source')
                 AND status IN ('pending','edited')
               ORDER BY created_at DESC LIMIT 5`,
              project_id,
            );
            let injected = 0;
            for (const pa of pendingWatchers) {
              // Skip any the agent already rendered (its card carries this id).
              if (fullResponse.includes(pa.id)) continue;
              const pl = (typeof pa.payload === 'string' ? JSON.parse(pa.payload) : pa.payload) as Record<string, unknown> | null;
              if (!pl) continue;
              let card: string;
              if (pa.action_type === 'configure_watch_source') {
                // Render URL watchers as a monitor-proposal card too — it's the
                // only watcher card type with an inline renderer, and Apply works
                // via pending_action_id regardless (the executor dispatches by the
                // action's real action_type). Map the watch-source fields in.
                const body: Record<string, unknown> = {
                  action: 'create',
                  name: pl.label ?? 'URL watcher',
                  objective: pl.rationale ?? `Watch ${pl.url ?? 'a page'} for changes`,
                  kind: 'url_diff',
                  schedule: pl.schedule,
                  alert_threshold: 'page content changes',
                  linked_risk_id: 'ad_hoc',
                  urls_to_track: pl.url ? [pl.url] : [],
                  pending_action_id: pa.id,
                  sources: withSourceTitles(pl.sources),
                };
                card = `\n\n:::artifact{"type":"monitor-proposal","id":"mon_prop_${pa.id.slice(-12)}"}\n${JSON.stringify(body)}\n:::`;
              } else {
                const rawSources = Array.isArray(pl.sources) && pl.sources.length
                  ? pl.sources
                  : (pl.linked_quote ? [{ type: 'user', quote: String(pl.linked_quote) }] : []);
                const body: Record<string, unknown> = {
                  action: 'create',
                  name: pl.name, objective: pl.objective, kind: pl.kind, schedule: pl.schedule,
                  alert_threshold: pl.alert_threshold, linked_risk_id: pl.linked_risk_id,
                  estimated_monthly_cost_eur: pl.estimated_monthly_cost_eur,
                  estimated_daily_credits: pl.estimated_daily_credits,
                  estimated_monthly_credits: pl.estimated_monthly_credits,
                  estimated_per_run_credits: pl.estimated_per_run_credits,
                  pending_action_id: pa.id,
                  sources: withSourceTitles(rawSources),
                };
                if (pl.query) body.query = pl.query;
                if (Array.isArray(pl.urls_to_track) && pl.urls_to_track.length) body.urls_to_track = pl.urls_to_track;
                if (pl.linked_quote) body.linked_quote = pl.linked_quote;
                card = `\n\n:::artifact{"type":"monitor-proposal","id":"mon_prop_${pa.id.slice(-12)}"}\n${JSON.stringify(body)}\n:::`;
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: card })}\n\n`));
              injected += 1;
            }
            console.info('[chat] watcher-card backstop', { pending: pendingWatchers.length, injected });
          }
        } catch (err) {
          console.warn('[chat] watcher-card backstop failed (non-fatal):', (err as Error).message);
        }

        // Emit done event with cost + credits so the client can show per-message credits
        try {
          const donePayload: Record<string, unknown> = { done: true };
          // Inbox-mutating turn → tell the client to refresh the inbox / monitors
          // / tasks panels. The agent's tool calls (dismiss, propose_monitor,
          // create_task, …) change pending_actions server-side, but the chat turn
          // only ever fired lp-persisted-artifacts — so the Inbox badge + Watchers
          // panel showed stale data until a manual refresh. Fire when any
          // non-read-only tool ran this turn.
          const READ_ONLY_TOOLS = new Set([
            'get_project_summary', 'get_project_metrics', 'list_ecosystem_alerts',
            'list_pending_actions', 'list_graph_nodes', 'list_intelligence_briefs',
            'get_risk_audit', 'read_tabular_review', 'list_open_assumptions', 'web_search',
          ]);
          if (toolsList.some((t) => !READ_ONLY_TOOLS.has(t.name))) {
            donePayload.inbox_changed = true;
          }
          // Include persisted artifact IDs so the client can wire apply/reject
          if (Object.keys(persistedMap).length > 0) {
            donePayload.persisted_artifacts = persistedMap;
          }
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
        } finally {
          // Clear the safety timer — flush completed before deadline.
          clearTimeout(flushDeadline);
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

  // Fallback: direct LLM with real token tracking (works without Pi Agent SDK).
  // Uses chatWithUsage (non-streaming) instead of chatStream so we get exact
  // token counts. Acceptable tradeoff: this path only fires when the Pi Agent
  // SDK throws — the primary chat path above handles streaming.
  const fullMessages = await buildDirectMessages(project_id, step, messages);
  const directStart = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Use the router instead of the request-body provider so this path
        // respects OPENROUTER_API_KEY when set. Without this, a deploy with
        // only OPENROUTER_API_KEY configured would hit OpenAI on every
        // pi-agent crash and fail with apiKey='unused'.
        const picked = pickModel('chat');
        const fbProvider = picked.provider;
        const fbModel = picked.model;
        const { text: directResponseText, usage: dUsage } = await chatWithUsage(
          fullMessages, fbProvider, 0.7, picked.maxTokens, fbModel,
        );
        const latencyMs = Date.now() - directStart;
        // Prefer provider-reported cost (OpenRouter); fall back to PRICING-table.
        const cost = typeof dUsage.cost_usd === 'number'
          ? dUsage.cost_usd
          : estimateCost(fbProvider, fbModel, dUsage);
        const fallbackNotice = '\n\n---\n*[Running in limited mode — project tools unavailable. Responses are based on general knowledge, not your project data. Please retry if this persists.]*\n';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: directResponseText + fallbackNotice })}\n\n`));
        await logUsageToDb(project_id, null, step, fbProvider, fbModel, dUsage, cost, latencyMs);
        logToLangfuse(
          { projectId: project_id, step, provider: fbProvider as 'anthropic' | 'openai' | 'openrouter', model: fbModel },
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

  const allCompletions = await query<{ skill_id: string; summary: string; completed_at: Date | string }>(
    'SELECT skill_id, summary, completed_at FROM skill_completions WHERE project_id = ? AND status = ?',
    projectId, 'completed',
  );
  // Defensive: drop legacy rows saved as 'completed' BEFORE the quality gate —
  // clarification-only/empty output must not be fed to the agent as "[COMPLETED
  // SKILL DATA — you MUST reference this]". New rows are already gated to
  // 'incomplete' at the write side (skill-executor / POST /skills).
  const completions = allCompletions.filter((c) => !isClarificationOnly(c.summary));

  if (completions.length === 0) return '';

  const TOTAL_BUDGET = 8000;
  const perSkillBudget = Math.min(2000, Math.floor(TOTAL_BUDGET / completions.length));
  const artifactRegex = /:::artifact[\s\S]*?:::/g;

  let context = '[COMPLETED SKILL DATA — You MUST reference this data in your analysis. Do not generate from scratch.]\n';
  for (const c of completions) {
    const clean = (c.summary || '').replace(artifactRegex, '').trim();
    const truncated = clean.slice(0, perSkillBudget);
    const completedDay = c.completed_at instanceof Date
      ? c.completed_at.toISOString().split('T')[0]
      : (typeof c.completed_at === 'string' ? c.completed_at.split('T')[0] : 'recently');
    context += `--- ${c.skill_id} (completed ${completedDay}) ---\n${truncated}\n\n`;
  }
  context += '[END COMPLETED SKILL DATA]\n\n';

  return context;
}
