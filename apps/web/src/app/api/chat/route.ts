import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import { query } from '@/lib/db';
import { chatStream } from '@/lib/llm';
import { STEP_SYSTEM_PROMPTS } from '@/lib/llm/prompts';

// Artifact instructions prepended to every message
const ARTIFACT_INSTRUCTIONS = `[You are LaunchPad, a proactive startup advisor. MANDATORY: Use :::artifact{} blocks.

entity-card for entities: :::artifact{"type":"entity-card","id":"ent_ID"}\n{"name":"X","entity_type":"competitor","summary":"...","attributes":{}}\n:::
option-set for choices: :::artifact{"type":"option-set","id":"opt_ID"}\n{"prompt":"?","options":[{"id":"a","label":"A","description":"..."}]}\n:::
insight-card for findings: :::artifact{"type":"insight-card","id":"ins_ID"}\n{"category":"market","title":"...","body":"...","confidence":"high"}\n:::
action-suggestion for next steps: :::artifact{"type":"action-suggestion","id":"act_ID"}\n{"title":"...","description":"...","action_label":"Go","action_type":"research"}\n:::
workflow-card for multi-step tasks: :::artifact{"type":"workflow-card","id":"wf_ID"}\n{"title":"...","category":"marketing","description":"...","priority":"high","steps":["1","2","3"]}\n:::
tool-trigger for tool invocations: :::artifact{"type":"tool-trigger","id":"tt_ID"}\n{"tool_name":"generate-landing-page","params":{"style":"modern"},"label":"Generate Landing Page","description":"Create a professional landing page from your startup data"}\n:::

Available tools: generate-landing-page, generate-pitch-deck, generate-one-pager, iterate-draft, publish-to-daytona, claude-code-execute

RULES: 1) ALWAYS end with option-set or action-suggestion 2) entity-card for EVERY entity 3) workflow-card for concrete multi-step actions 4) tool-trigger when the user needs to generate, publish, or execute something 5) Be proactive — use your tools to research, browse web, challenge assumptions]

`;

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body) {
    return new Response(
      JSON.stringify({ success: false, error: 'Request body required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { project_id, step = 'idea', messages = [], provider = 'openai' } = body;

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

  const lastMessage = messages[messages.length - 1]?.content || '';
  const projectContext = `[PROJECT: "${projects[0].name}"${projects[0].description ? ` — ${projects[0].description}` : ''}]\n`;
  const enrichedMessage = `${ARTIFACT_INSTRUCTIONS}${projectContext}${lastMessage}`;
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
          // stderr may have progress info — ignore unless it's an error
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
  const fullMessages = buildDirectMessages(project_id, step, messages);

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

function buildDirectMessages(projectId: string, step: string, messages: { role: string; content: string }[]) {
  let systemPrompt = STEP_SYSTEM_PROMPTS[step] || STEP_SYSTEM_PROMPTS['idea'];

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
