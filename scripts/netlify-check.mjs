#!/usr/bin/env node
/**
 * One-shot script: list Netlify sites using the NETLIFY_AUTH_TOKEN from .env.local,
 * then check env vars on any matching site.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');

// Parse NETLIFY_AUTH_TOKEN from .env.local
const tokenMatch = envContent.match(/NETLIFY_AUTH_TOKEN="?([^"\n]+)"?/);
if (!tokenMatch) {
  console.error('No NETLIFY_AUTH_TOKEN found in .env.local');
  process.exit(1);
}
const token = tokenMatch[1];

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// 1. List all sites
const sitesRes = await fetch('https://api.netlify.com/api/v1/sites', { headers });
const sites = await sitesRes.json();

console.log(`\n=== Found ${sites.length} site(s) ===\n`);
for (const s of sites) {
  console.log(`  Name: ${s.name}`);
  console.log(`  ID:   ${s.id}`);
  console.log(`  URL:  ${s.ssl_url || s.url}`);
  console.log(`  Repo: ${s.build_settings?.repo_url || 'not connected'}`);
  console.log(`  Deploy status: ${s.published_deploy?.state || 'unknown'}`);
  console.log('');

  // 2. Get env vars for this site
  const envRes = await fetch(`https://api.netlify.com/api/v1/accounts/${s.account_slug}/env?site_id=${s.id}`, { headers });
  if (envRes.ok) {
    const envVars = await envRes.json();
    console.log(`  --- Env vars (${envVars.length}) ---`);
    for (const v of envVars) {
      const val = v.values?.[0]?.value || '';
      const masked = val.length > 8 ? val.slice(0, 4) + '...' + val.slice(-4) : '****';
      console.log(`    ${v.key} = ${masked} [${v.values?.[0]?.context || 'all'}]`);
    }
  } else {
    console.log(`  --- Could not fetch env vars: ${envRes.status} ---`);
  }
  console.log('');
}

// 3. Also list accounts/teams accessible with this token
const accountsRes = await fetch('https://api.netlify.com/api/v1/accounts', { headers });
const accounts = await accountsRes.json();
console.log(`=== Accounts/Teams accessible ===`);
for (const a of accounts) {
  console.log(`  ${a.name} (${a.slug}) - ${a.type_name}`);
}
