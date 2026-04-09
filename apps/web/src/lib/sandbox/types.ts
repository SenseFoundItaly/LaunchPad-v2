export interface SandboxProvider {
  name: string;
  available: boolean;
  createWorkspace(config: WorkspaceConfig): Promise<string>;
  executeInWorkspace(workspaceId: string, command: string): Promise<ExecutionResult>;
  writeFiles(workspaceId: string, files: Record<string, string>): Promise<void>;
  getWorkspaceUrl(workspaceId: string): Promise<string | null>;
  deleteWorkspace(workspaceId: string): Promise<void>;
}

export interface WorkspaceConfig {
  name: string;
  template?: string;
  env?: Record<string, string>;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
