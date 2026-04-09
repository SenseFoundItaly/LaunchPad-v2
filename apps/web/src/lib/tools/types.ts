export interface ToolDefinition {
  id: string;
  name: string;
  display_name: string;
  description: string;
  category: 'publish' | 'draft' | 'generate' | 'deploy' | 'execute';
  input_schema: Record<string, unknown>;
  handler_type: 'builtin' | 'sandbox' | 'claude-code';
  handler_config: Record<string, unknown>;
  enabled: boolean;
}

export interface ToolExecutionContext {
  projectId: string;
  draftId?: string;
  workflowStep?: string;
  workflowRunId?: string;
  provider?: string;
}

export interface ToolResult {
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  draftId?: string;
  publishedUrl?: string;
}

export type ToolHandler = (
  params: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<ToolResult>;

export interface WorkflowStep {
  id: string;
  tool_name: string;
  params: Record<string, unknown>;
  depends_on?: string[];
  requires_approval: boolean;
  output_mapping?: Record<string, string>;
}

export interface WorkflowPlan {
  id: string;
  project_id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  status: 'planned' | 'running' | 'paused' | 'completed' | 'failed';
  current_step: number;
}
