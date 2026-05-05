/**
 * Design-system icon set. Monoline, flat, consistent.
 * Ported verbatim from the design brief's shared.jsx.
 *
 * Usage:
 *   import { Icon, I } from '@/components/design/icons';
 *   <Icon d={I.home} size={14} />
 */

import * as React from 'react';

export interface IconProps {
  d: string;
  size?: number;
  stroke?: number;
  style?: React.CSSProperties;
  className?: string;
}

export function Icon({ d, size = 14, stroke = 1.25, style, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

export const I = {
  home: 'M2.5 7.5L8 3l5.5 4.5V13a1 1 0 0 1-1 1h-2.5v-4h-4v4H3.5a1 1 0 0 1-1-1z',
  chat: 'M2.5 4h11v7h-6l-3 2.5V11h-2z',
  graph: 'M3 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm10-6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 11l6-4m0 4l-6-4',
  org: 'M8 2v3m-4 3v5m8-5v5M2 5h12M5 10h6',
  pipe: 'M2 4h5v3H2zm7 0h5v3H9zM2 9h5v3H2zm7 0h5v3H9zM7 5.5h2M7 10.5h2',
  tickets: 'M2 5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2.5a1 1 0 0 0 0 1V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8.5a1 1 0 0 0 0-1zM6 4v8',
  fund: 'M2 13h12M4 13V8m3 5V5m3 8V9m3 4V6',
  search: 'M7 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm3.5-1.5L14 14',
  play: 'M5 3l7 5-7 5z',
  pause: 'M5 3v10m6-10v10',
  plus: 'M8 3v10M3 8h10',
  more: 'M4 8h.01M8 8h.01M12 8h.01',
  send: 'M14 2L7 9m7-7L9 14l-2-5-5-2z',
  file: 'M4 2h5l3 3v9H4zM9 2v3h3',
  bolt: 'M9 2L3 9h5l-1 5 6-7H8z',
  check: 'M3 8l3 3 7-7',
  x: 'M3 3l10 10M13 3L3 13',
  chevr: 'M6 4l4 4-4 4',
  chevd: 'M4 6l4 4 4-4',
  chevu: 'M4 10l4-4 4 4',
  eye: 'M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8zm7 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  clock: 'M8 4v4l2.5 1.5M14 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0z',
  dollar: 'M8 2v12M11 4.5A2.5 2.5 0 0 0 8.5 2h-1A2.5 2.5 0 0 0 5 4.5C5 7 11 7 11 9.5a2.5 2.5 0 0 1-2.5 2.5h-1A2.5 2.5 0 0 1 5 11.5',
  heart: 'M8 13s-5-3-5-7a2.5 2.5 0 0 1 5-1 2.5 2.5 0 0 1 5 1c0 4-5 7-5 7z',
  shield: 'M8 2l5 2v4c0 3-2.5 5-5 6-2.5-1-5-3-5-6V4z',
  link: 'M6 10l4-4M5 11a2 2 0 0 1 0-3l1.5-1.5M10 5l1.5-1.5a2 2 0 0 1 3 3L13 8M7 11l-1.5 1.5a2 2 0 0 1-3-3L4 8',
  sliders: 'M3 4h4m2 0h4M3 8h8m2 0h0M3 12h2m2 0h6',
  zap: 'M9 1L3 9h4l-1 6 7-8H9z',
  layers: 'M8 2l6 3-6 3-6-3zm-6 6l6 3 6-3m-12 3l6 3 6-3',
  terminal: 'M2 3h12v10H2zm3 3l2 2-2 2m3 0h4',
  bell: 'M4 7a4 4 0 0 1 8 0v3l1 2H3l1-2zm2 5a2 2 0 0 0 4 0',
  arrow: 'M3 8h10m-4-4l4 4-4 4',
  sparkles: 'M6 3v2m0 2v2M4 5h2m0 2h2M11 8v2m0 2v2M9 10h2m0 2h2M10 2l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  filter: 'M2 4h12l-4 5v4l-4-2V9z',
  globe: 'M8 14A6 6 0 1 1 8 2a6 6 0 0 1 0 12zm0 0c2-2 3-4 3-6s-1-4-3-6c-2 2-3 4-3 6s1 4 3 6zM2 8h12',
  users: 'M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm0 0c-2 0-4 1-4 3v2h8v-2c0-2-2-3-4-3zm5-1a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 0c-.5 0-1 .1-1.5.3M10 13h4v-2c0-1.5-1.5-2.5-3-2.5',
  history: 'M2 8a6 6 0 1 1 2 4.5M2 3v3h3M8 5v3l2 2',
  copy: 'M4 4h6v6H4zM6 4V2h6v6h-2',
  external: 'M6 3H3v10h10v-3M9 3h4v4M13 3L8 8',
  folder: 'M2 4h4l1 1h7v7H2z',
  flag: 'M3 14V2m0 0h9l-2 3 2 3H3',
  stop: 'M3 3h10v10H3z',
  download: 'M8 2v8m0 0l-3-3m3 3l3-3M3 13h10',
  signal: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-4 2a6 6 0 0 1 0-8m8 0a6 6 0 0 1 0 8',
  expand: 'M3 10v3h3m8-3v3h-3M3 6V3h3m8 3V3h-3',
  collapse: 'M3 10l3-3m5 6h3v-3M3 6l3 3m5-6h3v3',
  printer: 'M5 2v3H2v6h3v3h6v-3h3V5h-3V2H5zm0 3h6v2H5V5zm0 5h6v3H5v-3z',
} as const;

export type IconKey = keyof typeof I;
