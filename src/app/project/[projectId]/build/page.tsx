'use client';

/**
 * Build — the generative surface, 3-pane: Refine (composer) · Preview · Grounding
 * + versions. Generation runs through the co-pilot (the real path): the refine
 * composer hands the brief to chat with a Build intent, where the model emits an
 * html-preview artifact. The preview + version history render here once a
 * build-artifact read endpoint exists; today the pane frames that hand-off.
 */

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSetChrome } from '@/components/design/chrome-context';
import { Icon, I } from '@/components/design/icons';
import { useKnowledgeCount } from '@/hooks/useKnowledgeCount';
import { BuildVersionsSidebar, type BuildVersion } from '@/components/build/BuildVersionsSidebar';

const SAMPLE_VERSIONS: BuildVersion[] = [
  { id: 'v1', label: 'v1', meta: 'draft', current: true },
];

export default function BuildPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const router = useRouter();
  const [brief, setBrief] = useState('');
  const { count: groundingCount } = useKnowledgeCount(projectId);

  useSetChrome({ breadcrumb: ['Build'] }, []);

  function generate() {
    const text = brief.trim();
    if (!text) return;
    // Real generation path: hand the brief to the co-pilot with a Build intent.
    router.push(`/project/${projectId}/chat?prefill=${encodeURIComponent(`Build: ${text}`)}`);
  }

  return (
    <div className="lp-rise" style={{ flex: 1, minWidth: 0, display: 'flex', minHeight: 0 }}>
      {/* Refine */}
      <div className="lp-scroll" style={{ width: 340, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--paper-2)', overflow: 'auto', padding: '16px 18px' }}>
        <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Refine</div>
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.55, marginTop: 0 }}>
          Describe what to build — a landing page, a one-pager, an email. The co-pilot generates it grounded in your Project Knowledge, and you refine it in the conversation.
        </p>
        <textarea
          className="lp-input"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. A landing page for the night-before-pitch wedge. Lead with the painful moment; pull 3 founder quotes as social proof."
          rows={5}
          style={{ marginTop: 12, resize: 'vertical' }}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generate(); }}
        />
        <button className="lp-btn lp-btn-primary" onClick={generate} disabled={!brief.trim()} style={{ width: '100%', marginTop: 10 }}>
          <Icon d={I.bolt} size={12} /> Generate in Co-pilot
        </button>
      </div>

      {/* Preview */}
      <div style={{ flex: 1, minWidth: 0, background: 'var(--paper-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 380, color: 'var(--ink-4)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 'var(--r-l)', background: 'var(--surface)', border: '1px solid var(--line)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Icon d={I.layers} size={20} style={{ color: 'var(--ink-4)' }} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            Generated pages &amp; artifacts appear here. Describe what to build on the left — the co-pilot generates a live, refinable preview.
          </div>
        </div>
      </div>

      {/* Grounding + versions */}
      <BuildVersionsSidebar groundingCount={groundingCount ?? 0} versions={SAMPLE_VERSIONS} />
    </div>
  );
}
