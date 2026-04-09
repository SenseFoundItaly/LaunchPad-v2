import { v4 as uuid } from 'uuid';
import { chatJSON } from '@/lib/llm';
import { listTools } from '@/lib/tools/registry';
import type { WorkflowStep } from '@/lib/tools/types';

const PLANNER_PROMPT = `You are a workflow planner for LaunchPad, a startup OS.
Given a user request and the list of available tools, decompose the request into a sequence of tool invocations.

Available tools will be provided as JSON. Each tool has a name, description, category, and input_schema.

Return a JSON object with this shape:
{
  "name": "Short workflow name",
  "description": "What this workflow does",
  "steps": [
    {
      "id": "step_1",
      "tool_name": "tool-name-here",
      "params": { ... parameters matching the tool's input_schema ... },
      "depends_on": [],
      "requires_approval": false,
      "output_mapping": { "output_field": "next_step_param" }
    }
  ]
}

Rules:
- Use only tools from the available list
- Set requires_approval: true for publish/deploy steps
- Use output_mapping to pipe draft_id from generate steps to iterate/publish steps
- Keep plans minimal — only the steps actually needed`;

export async function planWorkflow(
  description: string,
  projectId: string,
  provider = 'openai',
): Promise<{ name: string; description: string; steps: WorkflowStep[] }> {
  const tools = listTools();
  const toolSummary = tools.map((t) => ({
    name: t.name,
    description: t.description,
    category: t.category,
    input_schema: t.input_schema,
  }));

  const result = await chatJSON<{
    name: string;
    description: string;
    steps: Array<{
      id?: string;
      tool_name: string;
      params: Record<string, unknown>;
      depends_on?: string[];
      requires_approval?: boolean;
      output_mapping?: Record<string, string>;
    }>;
  }>(
    [
      { role: 'system', content: PLANNER_PROMPT },
      {
        role: 'user',
        content: `Available tools:\n${JSON.stringify(toolSummary, null, 2)}\n\nRequest: ${description}\nProject ID: ${projectId}`,
      },
    ],
    provider,
  );

  const steps: WorkflowStep[] = result.steps.map((s, i) => ({
    id: s.id || `step_${i + 1}`,
    tool_name: s.tool_name,
    params: s.params,
    depends_on: s.depends_on || [],
    requires_approval: s.requires_approval || false,
    output_mapping: s.output_mapping,
  }));

  return {
    name: result.name,
    description: result.description,
    steps,
  };
}
