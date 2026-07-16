'use client';

/**
 * /demo layout — DEMO PURPOSES ONLY. The persistent workspace shell for every
 * demo page: banner + TopBar + NavRail + StatusBar, mirroring the real
 * project layout (src/app/project/[projectId]/layout.tsx). Each page renders
 * only its own content column (flex:1) into the slot next to the rail.
 *
 * The whole /demo tree is public (PUBLIC_PREFIXES in src/middleware.ts covers
 * /demo and /demo/*) and does zero data fetching.
 */

import * as React from 'react';
import { DemoBanner, DemoTopBar, DemoNavRail, DemoStatusBar } from './chrome';

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp-frame">
      <DemoBanner />
      <DemoTopBar />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <DemoNavRail />
        {children}
      </div>
      <DemoStatusBar />
    </div>
  );
}
