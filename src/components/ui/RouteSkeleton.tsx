/**
 * Route-level loading shell.
 *
 * A SERVER component on purpose: `loading.tsx` files render it while the route
 * segment's client bundle downloads and mounts, so it must not depend on the
 * client runtime, the locale provider, or any hook. It therefore carries NO
 * text — only shapes — which also keeps it out of the i18n surface entirely.
 *
 * Why this matters beyond looking busy: in the App Router, a `loading.tsx`
 * boundary is what makes prefetch worth anything on a dynamic route. Without
 * one, hovering a link prefetches nothing renderable and the click leaves the
 * old page on screen for the whole server round-trip (measured 2026-09-02:
 * ~200ms per navigation on prod, plus the client bundle). With one, the shell
 * is already in the router cache and paints on click.
 *
 * Variants mirror the real layouts closely enough that the swap to real
 * content does not jump.
 */

type Variant = 'list' | 'panels' | 'split' | 'canvas' | 'grid';

const bar = (w: string, h = 12): React.CSSProperties => ({
  width: w,
  height: h,
  borderRadius: 6,
  background: 'var(--paper-3)',
  flexShrink: 0,
});

const card: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-l)',
  background: 'var(--surface)',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

function Rows({ n, widths }: { n: number; widths: string[] }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ ...card, gap: 8 }}>
          <div style={bar(widths[i % widths.length], 13)} />
          <div style={bar('100%', 9)} />
          <div style={bar('62%', 9)} />
        </div>
      ))}
    </>
  );
}

export function RouteSkeleton({ variant = 'list' }: { variant?: Variant }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="lp-scroll lp-skeleton"
      style={{ flex: 1, minWidth: 0, overflow: 'hidden', background: 'var(--paper)' }}
    >
      <div
        style={{
          maxWidth: variant === 'canvas' || variant === 'split' ? 'none' : 1100,
          margin: '0 auto',
          padding: '24px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Header strip — every section has one. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={bar('42%', 20)} />
          <div style={bar('64%', 10)} />
        </div>

        {variant === 'grid' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Rows n={6} widths={['58%', '44%', '66%']} />
          </div>
        )}

        {variant === 'panels' && (
          <>
            <div style={{ ...card, height: 150 }}>
              <div style={bar('30%', 13)} />
              <div style={bar('100%', 9)} />
              <div style={bar('80%', 9)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
              <div style={{ ...card, height: 220 }}>
                <div style={bar('34%', 13)} />
                <div style={bar('92%', 9)} />
                <div style={bar('70%', 9)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Rows n={2} widths={['52%', '46%']} />
              </div>
            </div>
          </>
        )}

        {variant === 'list' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {['70px', '90px', '80px', '64px'].map((w) => (
                <div key={w} style={{ ...bar(w, 24), borderRadius: 999 }} />
              ))}
            </div>
            <Rows n={7} widths={['72%', '58%', '66%', '50%']} />
          </div>
        )}

        {variant === 'split' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Rows n={5} widths={['74%', '60%', '68%']} />
            </div>
            <div style={{ ...card, height: 320 }}>
              <div style={bar('44%', 13)} />
              <div style={bar('100%', 9)} />
              <div style={bar('86%', 9)} />
            </div>
          </div>
        )}

        {variant === 'canvas' && (
          <div
            style={{
              ...card,
              height: 'min(60vh, 520px)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ ...bar('180px', 180), borderRadius: '50%', opacity: 0.5 }} />
          </div>
        )}
      </div>
    </div>
  );
}

export default RouteSkeleton;
