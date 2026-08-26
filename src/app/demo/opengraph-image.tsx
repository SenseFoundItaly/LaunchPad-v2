import { ImageResponse } from 'next/og';

/**
 * The link preview for /demo — the one public URL sent to people who have
 * never seen the product, so it must not unfurl as the generic app card.
 *
 * This file convention rather than `export const metadata`: /demo/layout.tsx
 * and /demo/page.tsx are BOTH 'use client', and a client component cannot
 * export metadata — it would be silently ignored. `opengraph-image` is a route
 * file handled at build time, so it works either way.
 *
 * (Consequence, accepted: /demo still inherits the root og:title and
 * description. Changing those needs a server component wrapping the client
 * shell — a refactor of a working public page, not worth it for a subtitle.)
 */
export const runtime = 'edge';
export const alt = 'LaunchPad — see an idea become a plan';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PAPER = '#FBFAF7';
const INK = '#1A1917';
const INK_4 = '#6B6A63';
const PLUM = '#6B4E71';

export default function DemoOpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: PAPER,
          padding: '72px 80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: PLUM,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: PAPER,
              fontSize: 21,
              fontWeight: 700,
            }}
          >
            S
          </div>
          <div style={{ fontSize: 21, color: INK, fontWeight: 600 }}>LaunchPad</div>
          <div
            style={{
              marginLeft: 6,
              fontSize: 14,
              color: PLUM,
              border: `1px solid ${PLUM}`,
              borderRadius: 999,
              padding: '3px 12px',
            }}
          >
            DEMO
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 58, color: INK, lineHeight: 1.12, letterSpacing: -1.5, maxWidth: 960 }}>
            Guarda un’idea diventare un piano.
          </div>
          <div style={{ fontSize: 26, color: INK_4, lineHeight: 1.4, maxWidth: 900 }}>
            Cinque fasi, quattro loop, e le prove che servono a ogni passo.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 3, background: PLUM, borderRadius: 2 }} />
          <div style={{ fontSize: 19, color: INK_4 }}>launchpad.sensefound.io/demo</div>
        </div>
      </div>
    ),
    size,
  );
}
