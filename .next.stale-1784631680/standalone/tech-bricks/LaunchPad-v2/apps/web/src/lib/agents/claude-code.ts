import { spawn } from 'child_process';

export interface ClaudeCodeRequest {
  prompt: string;
  workingDirectory: string;
  allowedTools?: string[];
  timeout?: number;
  maxTurns?: number;
}

export async function* executeWithClaudeCode(
  request: ClaudeCodeRequest,
): AsyncGenerator<string> {
  const args = ['--print', '-p', request.prompt];

  if (request.allowedTools?.length) {
    args.push('--allowedTools', request.allowedTools.join(','));
  }

  if (request.maxTurns) {
    args.push('--max-turns', String(request.maxTurns));
  }

  const proc = spawn('claude', args, {
    cwd: request.workingDirectory,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const timeout = request.timeout || 120_000;
  const timer = setTimeout(() => proc.kill('SIGTERM'), timeout);

  try {
    for await (const chunk of proc.stdout) {
      const text = (chunk as Buffer).toString();
      if (text.trim()) yield text;
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function isClaudeCodeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn('claude', ['--version'], { stdio: 'pipe' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
      setTimeout(() => { proc.kill(); resolve(false); }, 2000);
    } catch {
      resolve(false);
    }
  });
}
