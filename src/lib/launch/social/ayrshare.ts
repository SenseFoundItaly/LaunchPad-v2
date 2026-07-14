/**
 * Ayrshare driver — single-key programmatic social posting.
 * POST https://api.ayrshare.com/api/post with {post, platforms}; the founder
 * links LinkedIn/X once in the Ayrshare dashboard (free tier: 20 posts/mo).
 */

import type { SocialAdapter, SocialPostInput, SocialPostOutcome } from './types';

const PLATFORM: Record<string, string> = { linkedin: 'linkedin', x: 'twitter' };

export const ayrshareSocial: SocialAdapter = {
  id: 'ayrshare',
  label: 'Ayrshare',
  isConfigured: () => !!process.env.AYRSHARE_API_KEY,

  async post(input: SocialPostInput): Promise<SocialPostOutcome> {
    try {
      const res = await fetch('https://api.ayrshare.com/api/post', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.AYRSHARE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ post: input.body, platforms: [PLATFORM[input.channel] ?? 'linkedin'] }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string; id?: string;
        postIds?: Array<{ platform?: string; postUrl?: string; id?: string }>;
        errors?: Array<{ message?: string }>;
      };
      if (!res.ok || data.status === 'error') {
        return { ok: false, stubbed: false, error: data.errors?.[0]?.message || `ayrshare → ${res.status}` };
      }
      return {
        ok: true,
        stubbed: false,
        postRef: data.id || data.postIds?.[0]?.id,
        url: data.postIds?.[0]?.postUrl,
      };
    } catch (err) {
      return { ok: false, stubbed: false, error: (err as Error).message };
    }
  },
};
