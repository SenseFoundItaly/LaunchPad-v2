/**
 * SenseFound logomark — the "protective bracket + validation arrow" mark from
 * the V1.1 brand guidelines (the framework that contains and validates ideas).
 *
 * Rendered from the spec geometry (4 corner brackets in Authority charcoal + a
 * diagonal sage/CLARITY arrow pointing up-right out of the frame). This is a
 * faithful reproduction, NOT the official vector — swap in the official SVG when
 * the asset is available (brand rule: do not manipulate the logo). Keep the two
 * elements' proportions if you edit.
 *
 * Props: size (px), and color overrides for the brackets + arrow so it works on
 * light (charcoal/sage) and dark (white/peach) surfaces per the logo-on-
 * background rules.
 */

export function Logomark({
  size = 22,
  bracketColor = 'var(--ink)',
  arrowColor = 'var(--moss)',
  title = 'SenseFound',
}: {
  size?: number;
  bracketColor?: string;
  arrowColor?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={title}
      style={{ flexShrink: 0, display: 'block' }}
    >
      {/* 4 corner brackets — the protective frame */}
      <g stroke={bracketColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8 V4 H8" />
        <path d="M16 4 H20 V8" />
        <path d="M20 16 V20 H16" />
        <path d="M8 20 H4 V16" />
      </g>
      {/* validation arrow — diagonal, pointing up-right out of the frame */}
      <g stroke={arrowColor} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.5 15.5 L15 9" />
        <path d="M10.5 9 H15 V13.5" />
      </g>
    </svg>
  );
}
