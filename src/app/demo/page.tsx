'use client';

/**
 * /demo — DEMO PURPOSES ONLY. Public, static mock of the LaunchPad end
 * vision: the MatchLens example project shown ~9 months in, after the full
 * L2 machine (Phase 0 → Validation Gate → Loops 1-4 → Modulo Trasversale →
 * launch → growth) has run its course.
 *
 * Zero data fetching — the route is public (see PUBLIC_PREFIXES in
 * src/middleware.ts), so nothing here may hit an authed API. Real chrome
 * (TopBar, StatusBar) + real primitives; the rail is a static replica
 * because the real NavRail self-fetches and links into /project/*.
 */

import * as React from 'react';
import { TopBar } from '@/components/design/chrome';
import { Pill, StatusBar } from '@/components/design/primitives';
import {
  DemoBanner, DemoNavRail, HeaderStrip, SpineSection, LoopTimeline,
  DataRoomSection, GrowthSection, BuildSection, ActivitySection, IntelSection,
  InboxSection, FooterNote,
} from './sections';

export default function DemoPage() {
  return (
    <div className="lp-frame">
      <DemoBanner />
      <TopBar
        breadcrumb={['MatchLens', 'Visione']}
        right={
          <>
            <Pill kind="n">38 crediti</Pill>
            <Pill kind="live" dot>DEMO</Pill>
          </>
        }
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <DemoNavRail />
        <div className="lp-scroll lp-rise" style={{ flex: 1, overflow: 'auto', padding: '24px 32px', scrollBehavior: 'smooth' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <HeaderStrip />
            <SpineSection />
            {/* Loops (primary) + Data Room / Inbox (secondary) — same 1.6fr/1fr
                split as the real Today dashboard (.lp-home-grid). */}
            <div className="lp-home-grid">
              <LoopTimeline />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <DataRoomSection />
                <InboxSection />
              </div>
            </div>
            <div className="lp-home-grid">
              <GrowthSection />
              <IntelSection />
            </div>
            <div className="lp-home-grid">
              <BuildSection />
              <ActivitySection />
            </div>
            <FooterNote />
          </div>
        </div>
      </div>
      <StatusBar
        heartbeatLabel="heartbeat · 3 osservatori attivi"
        heartbeatKind="healthy"
        gateway="demo · dati simulati"
        ctxLabel="2 segnali da rivedere"
        budget="crediti · 38/50"
        tz="Europe/Rome"
      />
    </div>
  );
}
