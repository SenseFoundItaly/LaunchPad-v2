#!/usr/bin/env node
/**
 * Local Netlify build + deploy.
 *
 * 1. `netlify build` — runs `npm run build` AND the Next.js runtime plugin,
 *    which generates .netlify/ artifacts (server functions, edge functions,
 *    static asset mappings) that match the current .next/ output.
 * 2. `netlify deploy --prod --no-build` — uploads the matched artifacts.
 *
 * Using `npm run build` alone would skip the runtime plugin, causing stale
 * .netlify/ artifacts and broken MIME types / 404s on deploy.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Read token from .env.local
const envContent = readFileSync(join(root, '.env.local'), 'utf-8');
const tokenMatch = envContent.match(/NETLIFY_AUTH_TOKEN="?([^"\n]+)"?/);
if (!tokenMatch) {
  console.error('No NETLIFY_AUTH_TOKEN in .env.local');
  process.exit(1);
}

const token = tokenMatch[1];
const env = { ...process.env, NETLIFY_AUTH_TOKEN: token };

// Build locally (npm run build + Next.js runtime plugin) then deploy.
// Using --build ensures the CLI properly merges .netlify/static/ into the
// CDN upload, which is needed for _next/static/* path mapping.
execFileSync('npx', ['netlify', 'deploy', '--prod', '--build'], {
  cwd: root,
  stdio: 'inherit',
  env,
  timeout: 600_000,
});
