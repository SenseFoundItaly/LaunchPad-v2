import { ImageResponse } from 'next/og';

/**
 * The link preview for launchpad.sensefound.io.
 *
 * Until now the app shipped NO OpenGraph metadata at all: every link pasted
 * into Slack, WhatsApp or LinkedIn unfurled as a bare grey box with a URL. For
 * a product whose only distribution is a founder sending a link to another
 * founder, that is the first impression, every time.
 *
 * Generated rather than a static PNG so the wordmark tracks the brand tokens
 * in one place and cannot drift from a file nobody remembers to re-export.
 */
export const runtime = 'edge';
export const alt = 'LaunchPad — validate your startup idea with evidence';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Brand tokens, inlined: an edge OG route cannot read the CSS custom
// properties the app uses, and a wrong-but-close colour is worse than a
// deliberate copy.
const PAPER = '#FBFAF7';
const INK = '#1A1917';
const INK_4 = '#6B6A63';
const MOSS = '#5A7D5A';

export default function OpengraphImage() {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 11,
              background: MOSS,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: PAPER,
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            S
          </div>
          <div style={{ fontSize: 22, color: INK, fontWeight: 600, letterSpacing: -0.2 }}>
            LaunchPad
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 62, color: INK, lineHeight: 1.12, letterSpacing: -1.6, maxWidth: 950 }}>
            Find the fatal flaw while pivoting is still cheap.
          </div>
          <div style={{ fontSize: 27, color: INK_4, lineHeight: 1.4, maxWidth: 880 }}>
            Answer three questions. Get your whole plan back — with every assumption named.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 3, background: MOSS, borderRadius: 2 }} />
          <div style={{ fontSize: 19, color: INK_4, letterSpacing: 0.3 }}>
            launchpad.sensefound.io
          </div>
        </div>
      </div>
    ),
    size,
  );
}
