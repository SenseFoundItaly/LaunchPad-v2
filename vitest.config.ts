import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// B0 (copilot-sota): stand up the test runner for the LaunchPad WEB CLOSURE only.
// This repo still carries the dormant OpenClaw substrate (src/agents, src/infra,
// src/gateway, src/commands, src/config, src/cli, src/cron, src/plugins,
// src/auto-reply — ~2,061 .test files) which has its own deps/setup and is NOT
// the product. We ALLOWLIST the web closure rather than blocklist the substrate,
// so new OpenClaw dirs can never silently re-enter the run.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Web closure only. tsx components that need a DOM should set
    // `// @vitest-environment jsdom` per-file (jsdom added when first needed).
    environment: 'node',
    // NOTE: src/hooks is NOT here — its existing .test files are all OpenClaw
    // substrate (gmail, bundled/*, session-memory) that import src/infra and
    // need uninstalled deps (dotenv). The web hooks (useChat) live there but
    // have no tests yet; when one is written, add that single file explicitly.
    include: [
      'src/lib/**/*.{test,spec}.{ts,tsx}',
      'src/types/**/*.{test,spec}.{ts,tsx}',
      'src/app/**/*.{test,spec}.{ts,tsx}',
      'src/components/**/*.{test,spec}.{ts,tsx}',
    ],
    // Defense-in-depth: even if an include glob ever widens, these stay out.
    exclude: [
      'node_modules/**', '.next/**', 'dist/**',
      'src/agents/**', 'src/infra/**', 'src/gateway/**', 'src/commands/**',
      'src/config/**', 'src/cli/**', 'src/cron/**', 'src/plugins/**',
      'src/auto-reply/**', 'src/hooks/**',
    ],
  },
});
