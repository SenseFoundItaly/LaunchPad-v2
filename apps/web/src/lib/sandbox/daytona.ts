import type { SandboxProvider, WorkspaceConfig, ExecutionResult } from './types';

const DAYTONA_API_URL = process.env.DAYTONA_API_URL;
const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;

async function daytonaFetch(path: string, options: RequestInit = {}) {
  const url = `${DAYTONA_API_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DAYTONA_API_KEY}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Daytona API error: ${res.status} ${text}`);
  }
  return res.json();
}

export const daytonaProvider: SandboxProvider = {
  name: 'daytona',
  get available() {
    return Boolean(DAYTONA_API_URL && DAYTONA_API_KEY);
  },

  async createWorkspace(config: WorkspaceConfig): Promise<string> {
    const template = config.template || process.env.DAYTONA_DEFAULT_TEMPLATE || 'node';
    const data = await daytonaFetch('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({
        name: config.name,
        template,
        env: config.env || {},
      }),
    });
    return data.id;
  },

  async executeInWorkspace(workspaceId: string, command: string): Promise<ExecutionResult> {
    const data = await daytonaFetch(`/api/workspaces/${workspaceId}/exec`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
    return {
      exitCode: data.exitCode ?? 0,
      stdout: data.stdout ?? '',
      stderr: data.stderr ?? '',
    };
  },

  async writeFiles(workspaceId: string, files: Record<string, string>): Promise<void> {
    await daytonaFetch(`/api/workspaces/${workspaceId}/files`, {
      method: 'POST',
      body: JSON.stringify({ files }),
    });
  },

  async getWorkspaceUrl(workspaceId: string): Promise<string | null> {
    const data = await daytonaFetch(`/api/workspaces/${workspaceId}`);
    return data.url || null;
  },

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await daytonaFetch(`/api/workspaces/${workspaceId}`, { method: 'DELETE' });
  },
};
