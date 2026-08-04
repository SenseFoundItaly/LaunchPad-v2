// Minimal, token-frugal verification of the v0 white-label deploy SEQUENCE —
// exactly the piece our adapter couldn't confirm without a live key. Mirrors
// v0.ts: create → (poll) → projects.create → deployments.create → webUrl.
//
// Run:  node --env-file=.env.local scripts/v0-e2e.mjs
// Costs ~1 v0 build (subject to the free-tier daily cap).

import { createClient } from 'v0-sdk';

const KEY = process.env.V0_API_KEY;
if (!KEY) {
  console.error('V0_API_KEY not set (run with: node --env-file=.env.local scripts/v0-e2e.mjs)');
  process.exit(1);
}
const c = createClient({ apiKey: KEY });

const BRIEF = `Build a modern, responsive landing page for "BeanBox", a specialty coffee
subscription. Sections: hero with CTA, 3 feature cards, a simple pricing block, and a
footer. Clean, intentional design. Ship a real, working first version.`;

async function main() {
  // CORRECTED sequence (per the live 409): project FIRST, then create the chat
  // INSIDE it, then deploy — mirrors the fixed v0 adapter.
  console.log('1/4 projects.create…');
  let project;
  try {
    project = await c.projects.create({ name: `launchpad-e2e-${Math.random().toString(36).slice(2, 10)}` });
    console.log('   projectId=', project?.id);
  } catch (e) {
    console.error('   ✗ projects.create failed:', e?.message || e);
    process.exit(4);
  }

  console.log('2/4 chats.create({projectId}) (sync — blocks until the version is built)…');
  let chat;
  try {
    chat = await c.chats.create({ message: BRIEF, chatPrivacy: 'private', responseMode: 'sync', projectId: project.id });
  } catch (e) {
    console.error('   ✗ create failed:', e?.message || e);
    process.exit(2);
  }
  const versionId = chat?.latestVersion?.id;
  console.log('   chatId   =', chat?.id);
  console.log('   versionId=', versionId);
  console.log('   demoUrl  =', chat?.latestVersion?.demoUrl || '(none — daily cap? phantom?)');
  if (!versionId) {
    console.error('   ✗ no version — likely the free-tier daily cap (7/day). Stop.');
    process.exit(3);
  }

  console.log('3/5 integrations.vercel.projects.create (a v0 deployment targets a Vercel project)…');
  try {
    await c.integrations.vercel.projects.create({ projectId: project.id, name: `launchpad-e2e-${Math.random().toString(36).slice(2, 8)}` });
    console.log('   ✓ Vercel project linked');
  } catch (e) {
    console.error('   ✗ vercel integration failed — is Vercel CONNECTED to your v0 account?:', e?.message || e);
    process.exit(6);
  }

  console.log('4/5 deployments.create({projectId, chatId, versionId})…');
  try {
    const dep = await c.deployments.create({ projectId: project.id, chatId: chat.id, versionId });
    console.log('   ✓ DEPLOYED');
    console.log('   deployment.webUrl =', dep?.webUrl);
    console.log('   deployment.id     =', dep?.id);
  } catch (e) {
    console.error('   ✗ deployments.create failed:', e?.message || e);
    process.exit(5);
  }

  console.log('5/5 done. Inspect webUrl above (white-label check) + demoUrl (preview).');
  console.log('   (Leaving the deployment up so you can eyeball it; delete via v0 dashboard.)');
}

main().catch((e) => {
  console.error('unexpected:', e?.message || e);
  process.exit(9);
});
