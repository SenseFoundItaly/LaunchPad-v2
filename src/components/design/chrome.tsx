/**
 * Design-system chrome — TopBar + NavRail.
 *
 * The NavRail is wired to Next.js Link so nav items are real routes:
 *   home → /project/{id}/dashboard
 *   chat → /project/{id}/chat
 *   graph → /project/{id}/chat?sidebar=graph  (graph lives in chat's right canvas)
 *   org → /project/{id}/org   (Phase 1 — doesn't exist yet; falls back to dashboard)
 *   pipe → /project/{id}/workflow
 *   tickets → /project/{id}/actions
 *   fund → /project/{id}/fundraising
 */

'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, I, type IconKey } from './icons';

// =============================================================================
// TopBar — 38px, brand mark + breadcrumbs + right slot
// =============================================================================

export interface TopBarProps {
  breadcrumb?: string[];
  right?: React.ReactNode;
  /** Legacy prop from design — accepted but ignored; theme is global. */
  theme?: 'paper' | 'ink';
}

export function TopBar({ breadcrumb, right }: TopBarProps) {
  return (
    <div
      style={{
        height: 38,
        flexShrink: 0,
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        {/* Brand mark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              background: 'var(--ink)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="var(--paper)"
              strokeWidth="1.4"
              strokeLinecap="round"
            >
              <path d="M2 2l6 6M2 8l6-6" />
            </svg>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: -0.1 }}>LaunchPad</span>
          <span style={{ fontSize: 11, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
            / sensefound
          </span>
        </div>
        {breadcrumb && breadcrumb.length > 0 && (
          <>
            <span style={{ color: 'var(--ink-6)' }}>·</span>
            <span
              style={{
                fontSize: 12,
                color: 'var(--ink-3)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {breadcrumb.map((b, i) => (
                <React.Fragment key={`${b}-${i}`}>
                  {i > 0 && <Icon d={I.chevr} size={10} style={{ opacity: 0.5 }} />}
                  <span style={{ color: i === breadcrumb.length - 1 ? 'var(--ink)' : 'var(--ink-4)' }}>
                    {b}
                  </span>
                </React.Fragment>
              ))}
            </span>
          </>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-4)' }}>
        {right}
      </div>
    </div>
  );
}

// =============================================================================
// NavRail — 54px left icon rail with micro labels
// =============================================================================

interface NavItem {
  id: string;
  iconKey: IconKey;
  label: string;
  /** Path segment after /project/{id}/ — e.g. 'dashboard', 'chat' */
  route: string;
  /** If true, highlight when pathname segment matches `route` loosely */
  fuzzy?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home',    iconKey: 'home',    label: 'Home',     route: 'dashboard' },
  { id: 'chat',    iconKey: 'chat',    label: 'Co-pilot', route: 'chat' },
  { id: 'graph',   iconKey: 'graph',   label: 'Graph',    route: 'intelligence' },
  { id: 'org',     iconKey: 'org',     label: 'Org',      route: 'org' },
  { id: 'pipe',    iconKey: 'pipe',    label: 'Pipeline', route: 'workflow' },
  { id: 'tickets', iconKey: 'tickets', label: 'Tickets',  route: 'actions' },
  { id: 'fund',    iconKey: 'fund',    label: 'Raise',    route: 'fundraising' },
];

export interface NavRailProps {
  projectId: string;
  /** Explicit override for which item is current. Otherwise inferred from pathname. */
  current?: string;
}

export function NavRail({ projectId, current }: NavRailProps) {
  const pathname = usePathname() || '';

  function isActive(item: NavItem): boolean {
    if (current) return current === item.id;
    return pathname.includes(`/project/${projectId}/${item.route}`);
  }

  return (
    <div
      style={{
        width: 54,
        flexShrink: 0,
        borderRight: '1px solid var(--line)',
        background: 'var(--paper-2)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 0',
        gap: 2,
      }}
    >
      {NAV_ITEMS.map((it) => {
        const on = isActive(it);
        return (
          <Link
            key={it.id}
            href={`/project/${projectId}/${it.route}`}
            title={it.label}
            style={{
              width: 42,
              padding: '8px 0',
              borderRadius: 'var(--r-m)',
              cursor: 'pointer',
              background: on ? 'var(--surface)' : 'transparent',
              boxShadow: on ? 'inset 0 0 0 1px var(--line)' : 'none',
              color: on ? 'var(--ink)' : 'var(--ink-4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              textDecoration: 'none',
              transition: 'background .12s, color .12s',
            }}
          >
            <Icon d={I[it.iconKey]} size={15} stroke={1.3} />
            <span
              style={{
                fontSize: 9,
                fontFamily: 'var(--f-mono)',
                letterSpacing: -0.2,
                textTransform: 'uppercase',
              }}
            >
              {it.label}
            </span>
          </Link>
        );
      })}
      <div style={{ flex: 1 }} />
      {/* User chip — placeholder initials */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          background: 'var(--ink)',
          color: 'var(--paper)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 600,
          fontFamily: 'var(--f-mono)',
        }}
      >
        LB
      </div>
    </div>
  );
}
