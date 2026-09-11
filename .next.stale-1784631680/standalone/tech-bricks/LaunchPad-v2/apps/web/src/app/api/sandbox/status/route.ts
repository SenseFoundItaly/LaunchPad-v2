import { json } from '@/lib/api-helpers';
import { isSandboxAvailable, getSandboxProvider } from '@/lib/sandbox/manager';
import { isClaudeCodeAvailable } from '@/lib/agents/claude-code';

export async function GET() {
  const claudeCode = await isClaudeCodeAvailable();
  const provider = getSandboxProvider();

  return json({
    sandbox: {
      available: isSandboxAvailable(),
      provider: provider.name,
    },
    claude_code: {
      available: claudeCode,
    },
  });
}
