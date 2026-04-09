import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatStream } from '@/lib/llm';
import { STEP_SYSTEM_PROMPTS } from '@/lib/llm/prompts';

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
10) Be proactive — use tools to research, browse web, challenge assumptions]

`;

export async function POST(request: NextRequest) {
  let user;
  try { user = await requireUser(); } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
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

  const supabase = await createServerSupabase();

  // Verify project exists and belongs to user
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, description')
    .eq('id', project_id)
    .eq('user_id', user.id)
    .single();

  if (!project) {
    return new Response(
      JSON.stringify({ success: false, error: 'Project not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const lastMessage = messages[messages.length - 1]?.content || '';
  const projectContext = `[PROJECT: "${project.name}"${project.description ? ` — ${project.description}` : ''}]\n`;

  // Inject completed skill data when running a skill kickoff
  const skillContext = await buildCompletedSkillContext(supabase, project_id, lastMessage);
  const enrichedMessage = `${ARTIFACT_INSTRUCTIONS}${projectContext}${skillContext}${lastMessage}`;
  const encoder = new TextEncoder();

  // Try OpenClaw Gateway via CLI (has tools, skills, memory, web access)
  const useGateway = await isOpenClawAvailable();

  if (useGateway) {
    const sessionId = `launchpad-${project_id}-${step}`;

    const stream = new ReadableStream({
      start(controller) {
        const proc = spawn('openclaw', [
          'agent',
          '--agent', 'sonnet',
          '--session-id', sessionId,
          '--message', enrichedMessage,
          '--timeout', '120',
        ], {
          env: { ...process.env },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        proc.stdout.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          if (text.trim()) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
          }
        });

        proc.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          if (text.includes('Error') || text.includes('error')) {
            console.error('openclaw agent stderr:', text);
          }
        });

        proc.on('close', (code) => {
          if (code !== 0) {
            console.error(`openclaw agent exited with code ${code}`);
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        });

        proc.on('error', (err) => {
          console.error('openclaw agent spawn error:', err);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
          controller.close();
        });
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

  // Fallback: direct LLM (no tools, but works without OpenClaw)
  const fullMessages = await buildDirectMessages(supabase, project_id, step, messages);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of chatStream(fullMessages, provider)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
        }
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

/** Check if openclaw CLI is available */
async function isOpenClawAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn('openclaw', ['--version'], { stdio: 'pipe' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
      setTimeout(() => { proc.kill(); resolve(false); }, 2000);
    } catch {
      resolve(false);
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildDirectMessages(supabase: any, projectId: string, step: string, messages: { role: string; content: string }[]) {
  let systemPrompt = STEP_SYSTEM_PROMPTS[step] || STEP_SYSTEM_PROMPTS['chat'];

  const { data: project } = await supabase
    .from('projects')
    .select('name, description')
    .eq('id', projectId)
    .single();

  if (project) {
    systemPrompt += `\n\nProject: "${project.name}"${project.description ? ` — ${project.description}` : ''}`;
  }

  const { data: ideaCanvas } = await supabase
    .from('idea_canvas')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();

  if (ideaCanvas) {
    systemPrompt += `\n\nCurrent Idea Canvas:\n${JSON.stringify(ideaCanvas, null, 2)}`;
  }

  return [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map((m: { role: string; content: string }) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];
}

/** Build context from completed skills to inject into skill kickoff prompts */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildCompletedSkillContext(supabase: any, projectId: string, message: string): Promise<string> {
  // Only inject for skill kickoff messages
  const { SKILL_KICKOFFS } = require('@/lib/stages');
  const isKickoff = Object.values(SKILL_KICKOFFS).some((k: unknown) => typeof k === 'string' && message.includes(k));
  if (!isKickoff) return '';

  const { data: completions } = await supabase
    .from('skill_completions')
    .select('skill_id, summary, completed_at')
    .eq('project_id', projectId)
    .eq('status', 'completed');

  if (!completions || completions.length === 0) return '';

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
