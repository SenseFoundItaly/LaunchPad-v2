/**
 * PublisherAdapter — the launch pipeline's page-hosting driver contract.
 * Same shape philosophy as the Build Hub's BuilderAdapter (src/lib/builders):
 * env-selected registry, isConfigured() key-gating, stub fallback that works
 * with zero keys so the whole pipeline is testable end-to-end.
 *
 * A publisher takes ONE self-contained HTML page and puts it at a URL. That's
 * deliberately the entire contract: multi-file sites belong to the Build Hub's
 * builder drivers, not here.
 */

export type PublisherId = 'stub' | 'netlify';

export interface PublishInput {
  projectId: string;
  /** URL-safe site-name seed (publisher may suffix for uniqueness). */
  slug: string;
  /** Complete single-page HTML payload. */
  html: string;
  /** Republish to the same site (keeps the URL stable across iterations). */
  existingHostRef?: string;
}

export interface PublishResult {
  /** Driver handle for republish (netlify site_id; 'stub'). */
  hostRef: string;
  /** The live URL (netlify ssl_url; data:text/html for stub). */
  url: string;
  status: 'live' | 'failed';
  error?: string;
}

export interface PublisherAdapter {
  id: PublisherId;
  label: string;
  /** Honest one-liner for UI copy (Build Hub idiom). */
  notes: string;
  /** Key-gating: stub is always configured. */
  isConfigured(): boolean;
  publish(input: PublishInput): Promise<PublishResult>;
}
