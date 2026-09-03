'use client';

/**
 * Client boundary that keeps driver.js OUT of the root layout chunk.
 *
 * TourController was imported statically by app/layout.tsx, so every page in
 * the app shipped driver.js and its CSS to every visitor on every visit —
 * measured 2026-09-02: 44 KB, 14 KB of it inside the layout chunk itself — for
 * a walkthrough that runs once per account and renders null the rest of the
 * time. next/dynamic gives it its own chunk, fetched only when the controller
 * actually mounts.
 *
 * ssr:false is both correct and required: the tour is browser-only (it reads
 * sessionStorage and measures elements), and `next/dynamic({ssr:false})` is
 * not allowed in a server component, which the root layout is.
 */

import dynamic from 'next/dynamic';

const TourController = dynamic(() => import('./TourController'), { ssr: false });

export default function TourControllerLazy() {
  return <TourController />;
}
