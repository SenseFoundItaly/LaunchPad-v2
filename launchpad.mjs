#!/usr/bin/env node

// LaunchPad v2 — Startup OS on OpenClaw
// Usage: node launchpad.mjs [start|stop|status]

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = 'launchpad';
const GATEWAY_PORT = 19002;
const WEB_PORT = 3000;
const PROFILE_DIR = join(process.env.HOME, '.openclaw', 'profiles', PROFILE);

async function main() {
  const command = process.argv[2] || 'start';

  switch (command) {
    case 'start':
      await bootstrap();
      await startServices();
      break;
    case 'stop':
      stopServices();
      break;
    case 'status':
      checkStatus();
      break;
    default:
      console.log('Usage: node launchpad.mjs [start|stop|status]');
  }
}

async function bootstrap() {
  console.log('\n  LaunchPad — Startup OS\n');

  // 1. Check Node version
  const nodeVersion = process.versions.node.split('.').map(Number);
  if (nodeVersion[0] < 22) {
    console.error('  Node.js 22+ required. Current:', process.version);
    process.exit(1);
  }
  console.log('  [ok] Node.js', process.version);

  // 2. Check OpenClaw
  try {
    execSync('openclaw --version', { stdio: 'pipe' });
    console.log('  [ok] OpenClaw installed');
  } catch {
    console.log('  [..] Installing OpenClaw...');
    execSync('npm install -g openclaw@latest', { stdio: 'inherit' });
    console.log('  [ok] OpenClaw installed');
  }

  // 3. Create profile directory
  if (!existsSync(PROFILE_DIR)) {
    console.log('  [..] Creating LaunchPad profile...');
    mkdirSync(PROFILE_DIR, { recursive: true });
    mkdirSync(join(PROFILE_DIR, 'skills'), { recursive: true });
    mkdirSync(join(PROFILE_DIR, 'memory'), { recursive: true });

    // Copy default config
    const configSrc = join(__dirname, 'agents', 'openclaw.json');
    if (existsSync(configSrc)) {
      copyFileSync(configSrc, join(PROFILE_DIR, 'openclaw.json'));
    }
    console.log('  [ok] Profile created');
  } else {
    console.log('  [ok] Profile exists');
  }

  // 4. Copy/update skills
  const skillsSource = join(__dirname, 'agents', 'skills');
  const skillsDest = join(PROFILE_DIR, 'skills');
  if (existsSync(skillsSource)) {
    for (const skill of readdirSync(skillsSource)) {
      const skillDir = join(skillsSource, skill);
      const src = join(skillDir, 'SKILL.md');
      if (existsSync(src)) {
        const dest = join(skillsDest, skill);
        if (!existsSync(dest)) {mkdirSync(dest, { recursive: true });}
        copyFileSync(src, join(dest, 'SKILL.md'));
      }
    }
    console.log('  [ok] Skills installed (20 skills)');
  }

  // 5. Copy/update agent files
  const agentsSource = join(__dirname, 'agents');
  if (existsSync(agentsSource)) {
    for (const file of ['AGENTS.md', 'SOUL.md', 'HEARTBEAT.md']) {
      const src = join(agentsSource, file);
      if (existsSync(src)) {
        copyFileSync(src, join(PROFILE_DIR, file));
      }
    }
    console.log('  [ok] Agent configured (SOUL.md + AGENTS.md + HEARTBEAT.md)');
  }

  console.log('  [ok] Profile dir:', PROFILE_DIR);
}

async function startServices() {
  console.log('\n  Starting services...\n');

  // Start OpenClaw Gateway with LaunchPad profile
  console.log(`  [..] Gateway starting on ws://localhost:${GATEWAY_PORT}`);
  const gateway = spawn('openclaw', [
    '--profile', PROFILE,
    'gateway', 'run',
    '--bind', 'loopback',
    '--port', String(GATEWAY_PORT),
    '--force',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  gateway.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {console.log(`  [gateway] ${line}`);}
  });
  gateway.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {console.log(`  [gateway] ${line}`);}
  });

  // Wait a moment for gateway to start
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Start Next.js web app
  console.log(`  [..] Web UI starting on http://localhost:${WEB_PORT}`);
  const web = spawn('npm', ['run', 'dev'], {
    cwd: join(__dirname, 'apps', 'web'),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: {
      ...process.env,
      OPENCLAW_GATEWAY_URL: `ws://localhost:${GATEWAY_PORT}`,
      OPENCLAW_GATEWAY_TOKEN: 'launchpad-local',
    },
  });

  web.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {console.log(`  [web] ${line}`);}
  });
  web.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {console.log(`  [web] ${line}`);}
  });

  // Wait for web to be ready
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log(`\n  LaunchPad is running!`);
  console.log(`  Web UI:  http://localhost:${WEB_PORT}`);
  console.log(`  Gateway: ws://localhost:${GATEWAY_PORT}`);
  console.log(`\n  Press Ctrl+C to stop.\n`);

  // Handle shutdown
  const cleanup = () => {
    console.log('\n  Shutting down...');
    gateway.kill();
    web.kill();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep process alive
  await new Promise(() => {});
}

function stopServices() {
  console.log('  Stopping LaunchPad services...');
  try {
    execSync('pkill -f "openclaw.*--profile launchpad"', { stdio: 'pipe' });
    console.log('  [ok] Gateway stopped');
  } catch { /* not running */ }
  console.log('  Done.');
}

function checkStatus() {
  console.log('\n  LaunchPad Status\n');
  try {
    execSync('pgrep -f "openclaw.*--profile launchpad"', { stdio: 'pipe' });
    console.log('  Gateway: running');
  } catch {
    console.log('  Gateway: stopped');
  }
  console.log(`  Profile: ${PROFILE_DIR}`);
  console.log(`  Skills:  ${existsSync(join(PROFILE_DIR, 'skills')) ? 'installed' : 'not found'}`);
}

main().catch(console.error);
