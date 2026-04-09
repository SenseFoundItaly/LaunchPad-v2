import { v4 as uuid } from 'uuid';
import { query, run, get } from '@/lib/db';
import type { ToolDefinition, ToolHandler, ToolExecutionContext, ToolResult } from './types';
import { generateLandingPage } from './handlers/generate-landing-page';
import { generatePitchDeck } from './handlers/generate-pitch-deck';
import { generateOnePager } from './handlers/generate-one-pager';
import { iterateDraft } from './handlers/iterate-draft';

const handlers = new Map<string, ToolHandler>();

const BUILTIN_TOOLS: Omit<ToolDefinition, 'id'>[] = [
  {
    name: 'generate-landing-page',
    display_name: 'Generate Landing Page',
    description: 'Generate an HTML landing page from the project idea canvas and research data',
    category: 'generate',
    input_schema: {
      type: 'object',
      properties: {
        style: { type: 'string', enum: ['modern', 'minimal', 'bold', 'startup'], default: 'modern' },
        include_cta: { type: 'boolean', default: true },
      },
    },
    handler_type: 'builtin',
    handler_config: {},
    enabled: true,
  },
  {
    name: 'generate-pitch-deck',
    display_name: 'Generate Pitch Deck',
    description: 'Generate a pitch deck from project data with structured slides',
    category: 'generate',
    input_schema: {
      type: 'object',
      properties: {
        slide_count: { type: 'number', default: 10 },
        audience: { type: 'string', enum: ['investor', 'customer', 'partner'], default: 'investor' },
      },
    },
    handler_type: 'builtin',
    handler_config: {},
    enabled: true,
  },
  {
    name: 'generate-one-pager',
    display_name: 'Generate One-Pager',
    description: 'Generate a professional one-page startup summary for investors',
    category: 'generate',
    input_schema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['investor', 'partner', 'press'], default: 'investor' },
      },
    },
    handler_type: 'builtin',
    handler_config: {},
    enabled: true,
  },
  {
    name: 'iterate-draft',
    display_name: 'Iterate on Draft',
    description: 'Apply feedback to an existing draft and create a new version',
    category: 'draft',
    input_schema: {
      type: 'object',
      properties: {
        draft_id: { type: 'string' },
        feedback: { type: 'string' },
      },
      required: ['draft_id', 'feedback'],
    },
    handler_type: 'builtin',
    handler_config: {},
    enabled: true,
  },
  {
    name: 'publish-to-daytona',
    display_name: 'Publish to Daytona',
    description: 'Publish a draft to a Daytona workspace with a live preview URL',
    category: 'publish',
    input_schema: {
      type: 'object',
      properties: {
        draft_id: { type: 'string' },
      },
      required: ['draft_id'],
    },
    handler_type: 'sandbox',
    handler_config: { provider: 'daytona' },
    enabled: true,
  },
  {
    name: 'claude-code-execute',
    display_name: 'Execute with Claude Code',
    description: 'Run a multi-step task using Claude Code as the execution engine',
    category: 'execute',
    input_schema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        template: { type: 'string', enum: ['build-landing-page', 'build-mvp', 'iterate-with-feedback'] },
      },
      required: ['task'],
    },
    handler_type: 'claude-code',
    handler_config: {},
    enabled: true,
  },
];

let seeded = false;

function seedBuiltinTools() {
  if (seeded) return;
  for (const tool of BUILTIN_TOOLS) {
    const existing = get<{ id: string }>('SELECT id FROM tools WHERE name = ?', tool.name);
    if (!existing) {
      run(
        `INSERT INTO tools (id, name, display_name, description, category, input_schema, handler_type, handler_config, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `tool_${uuid().slice(0, 12)}`,
        tool.name,
        tool.display_name,
        tool.description,
        tool.category,
        JSON.stringify(tool.input_schema),
        tool.handler_type,
        JSON.stringify(tool.handler_config),
        tool.enabled ? 1 : 0,
      );
    }
  }
  seeded = true;
}

function registerHandlers() {
  handlers.set('generate-landing-page', generateLandingPage);
  handlers.set('generate-pitch-deck', generatePitchDeck);
  handlers.set('generate-one-pager', generateOnePager);
  handlers.set('iterate-draft', iterateDraft);
  // Phase 2+3 handlers registered when available
}

export function ensureToolsReady() {
  seedBuiltinTools();
  if (handlers.size === 0) registerHandlers();
}

export function getTool(name: string): ToolDefinition | undefined {
  ensureToolsReady();
  return get<ToolDefinition>('SELECT * FROM tools WHERE name = ? AND enabled = 1', name);
}

export function listTools(category?: string): ToolDefinition[] {
  ensureToolsReady();
  if (category) {
    return query<ToolDefinition>('SELECT * FROM tools WHERE category = ? AND enabled = 1', category);
  }
  return query<ToolDefinition>('SELECT * FROM tools WHERE enabled = 1');
}

export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  ensureToolsReady();

  const tool = getTool(toolName);
  if (!tool) {
    return { success: false, output: {}, error: `Tool not found: ${toolName}` };
  }

  const handler = handlers.get(toolName);
  if (!handler) {
    return { success: false, output: {}, error: `No handler registered for tool: ${toolName}` };
  }

  // Create execution record
  const execId = `exec_${uuid().slice(0, 12)}`;
  run(
    `INSERT INTO tool_executions (id, project_id, tool_id, draft_id, workflow_run_id, step_index, status, input_params, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?, CURRENT_TIMESTAMP)`,
    execId,
    context.projectId,
    tool.id,
    context.draftId || null,
    context.workflowRunId || null,
    null,
    JSON.stringify(params),
  );

  run('UPDATE tool_executions SET started_at = CURRENT_TIMESTAMP WHERE id = ?', execId);

  try {
    const result = await handler(params, context);
    run(
      `UPDATE tool_executions SET status = ?, output = ?, draft_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      result.success ? 'completed' : 'failed',
      JSON.stringify(result.output),
      result.draftId || null,
      execId,
    );
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    run(
      `UPDATE tool_executions SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      errorMsg,
      execId,
    );
    return { success: false, output: {}, error: errorMsg };
  }
}
