/**
 * Stub publisher — no network, no keys. "Publishes" by returning the page as
 * a data: URL, so every downstream record (published_assets row, Stage-5
 * something_shipped, the sim harness) exercises the real code path without an
 * external side effect. Mirrors the Build Hub's stub builder role.
 */

import type { PublisherAdapter, PublishInput, PublishResult } from './types';

export const stubPublisher: PublisherAdapter = {
  id: 'stub',
  label: 'Stub (no hosting)',
  notes: 'Records the publish without hosting anything — set LAUNCH_PUBLISHER=netlify + NETLIFY_API_KEY for real URLs.',
  isConfigured: () => true,
  async publish(input: PublishInput): Promise<PublishResult> {
    console.log(`[launch:stub] would publish ${input.html.length} chars as "${input.slug}" for project ${input.projectId}`);
    return {
      hostRef: input.existingHostRef || 'stub',
      url: `data:text/html;base64,${Buffer.from(input.html).toString('base64')}`,
      status: 'live',
    };
  },
};
