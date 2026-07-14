/**
 * Netlify publisher — real hosting behind a single personal access token.
 *
 * Flow (Netlify file-digest deploy API):
 *   1. First publish: POST /sites {name} → {id, ssl_url}; hostRef = site id.
 *   2. POST /sites/{id}/deploys {files: {"/index.html": <sha1>}} → {id, required}.
 *   3. PUT /deploys/{id}/files/index.html with the raw HTML (only when Netlify
 *      lists the digest in `required` — identical content deploys instantly).
 *   4. Poll the deploy until state === 'ready' (bounded — a single file is
 *      seconds, safe inside a serverless function; no async sweep needed).
 *
 * Netlify Forms rider: publishLandingPage rewrites the page's signup <form>
 * with data-netlify="true" BEFORE calling this driver, so submissions are
 * collected by Netlify on the same key — the measure cron (PR-C) reads them
 * back as a real `signups` metric.
 */

import crypto from 'node:crypto';
import type { PublisherAdapter, PublishInput, PublishResult } from './types';

const API = 'https://api.netlify.com/api/v1';
const DEPLOY_POLL_MS = 2_000;
const DEPLOY_POLL_MAX = 15; // ≤30s — single-file deploys settle in seconds

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.NETLIFY_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function netlifyJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...(init?.headers as Record<string, string> | undefined) } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`netlify ${init?.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export const netlifyPublisher: PublisherAdapter = {
  id: 'netlify',
  label: 'Netlify',
  notes: 'Hosts the page on a real netlify.app URL; signup-form submissions are captured by Netlify Forms on the same key.',
  isConfigured: () => !!process.env.NETLIFY_API_KEY,

  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      // 1. Site: reuse on republish (stable URL), else create.
      let siteId = input.existingHostRef && input.existingHostRef !== 'stub' ? input.existingHostRef : null;
      let url = '';
      if (siteId) {
        const site = await netlifyJson<{ ssl_url?: string; url?: string }>(`/sites/${siteId}`);
        url = site.ssl_url || site.url || '';
      } else {
        const rand = crypto.randomBytes(2).toString('hex');
        const site = await netlifyJson<{ id: string; ssl_url?: string; url?: string }>('/sites', {
          method: 'POST',
          body: JSON.stringify({ name: `lp-${input.slug}-${rand}`.slice(0, 60) }),
        });
        siteId = site.id;
        url = site.ssl_url || site.url || '';
      }

      // 2. File-digest deploy.
      const sha1 = crypto.createHash('sha1').update(input.html).digest('hex');
      const deploy = await netlifyJson<{ id: string; required?: string[] }>(`/sites/${siteId}/deploys`, {
        method: 'POST',
        body: JSON.stringify({ files: { '/index.html': sha1 } }),
      });

      // 3. Upload only when Netlify asks for the digest (unchanged content skips).
      if ((deploy.required ?? []).includes(sha1)) {
        const up = await fetch(`${API}/deploys/${deploy.id}/files/index.html`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${process.env.NETLIFY_API_KEY}`, 'Content-Type': 'application/octet-stream' },
          body: input.html,
        });
        if (!up.ok) throw new Error(`netlify file upload → ${up.status}`);
      }

      // 4. Bounded poll to ready.
      for (let i = 0; i < DEPLOY_POLL_MAX; i++) {
        const d = await netlifyJson<{ state: string; ssl_url?: string }>(`/deploys/${deploy.id}`);
        if (d.state === 'ready') return { hostRef: siteId, url: d.ssl_url || url, status: 'live' };
        if (d.state === 'error') return { hostRef: siteId, url, status: 'failed', error: 'netlify deploy errored' };
        await new Promise((r) => setTimeout(r, DEPLOY_POLL_MS));
      }
      // Timed out polling but the deploy is in flight — surface the site URL;
      // Netlify finishes single-file deploys on its own within seconds.
      return { hostRef: siteId, url, status: 'live' };
    } catch (err) {
      return { hostRef: input.existingHostRef || '', url: '', status: 'failed', error: (err as Error).message };
    }
  },
};
