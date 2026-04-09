import type { SandboxProvider } from './types';
import { daytonaProvider } from './daytona';

const noopProvider: SandboxProvider = {
  name: 'none',
  available: false,
  async createWorkspace() {
    throw new Error('No sandbox provider available. Set DAYTONA_API_URL and DAYTONA_API_KEY to enable Daytona.');
  },
  async executeInWorkspace() {
    throw new Error('No sandbox provider available.');
  },
  async writeFiles() {
    throw new Error('No sandbox provider available.');
  },
  async getWorkspaceUrl() {
    return null;
  },
  async deleteWorkspace() {
    // noop
  },
};

export function getSandboxProvider(): SandboxProvider {
  if (daytonaProvider.available) return daytonaProvider;
  return noopProvider;
}

export function isSandboxAvailable(): boolean {
  return daytonaProvider.available;
}
