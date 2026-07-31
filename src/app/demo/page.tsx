'use client';

/**
 * /demo (Home) — DEMO PURPOSES ONLY. The "today" dashboard for the MatchLens
 * example project. Chrome (banner, rail, top/status bars) is provided by
 * ./layout.tsx; this file renders only the scrollable content column.
 */

import * as React from 'react';
import {
  HeaderStrip, ScoreSection, SpineSection, LoopTimeline, WatchersPreview,
  InboxPreview, ActivitySection, EcosystemSection, FooterNote,
} from './sections';

export default function DemoHome() {
  return (
    <div className="lp-scroll lp-rise" style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <HeaderStrip />
        <ScoreSection />
        <SpineSection />
        {/* Loops (primary) + watchers / inbox / activity (secondary) — the
            same 1.6fr/1fr split as the real Today dashboard (.lp-home-grid). */}
        <div className="lp-home-grid">
          <LoopTimeline />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <WatchersPreview />
            <InboxPreview />
            <ActivitySection />
          </div>
        </div>
        <EcosystemSection />
        <FooterNote />
      </div>
    </div>
  );
}
