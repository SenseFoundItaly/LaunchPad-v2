/**
 * Design-system chrome — TopBar + NavRail.
 *
 * Three-item nav (the 100× simplification). Everything else is reachable
 * by URL but no longer takes nav real estate:
 *
 *   today   → /project/{id}/today    (briefs preview + inbox + pulse)
 *   signals → /project/{id}/signals  (briefs + findings + watchers)
 *   chat    → /project/{id}/chat     (co-pilot)
 *
 * Orphan routes still live under /project/{id}/* (workflow, journey,
 * growth, simulation, readiness, scoring, brief, assets, org, research,
 * fundraising, knowledge, intelligence, drafts, actions, dashboard) —
 * accessible via direct URL only, slated for deletion in a follow-up.
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
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: -0.1 }}>SenseFound</span>
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
  { id: 'today',   iconKey: 'home',    label: 'Today',    route: 'today' },
  { id: 'inbox',   iconKey: 'tickets', label: 'Inbox',    route: 'actions' },
  { id: 'signals', iconKey: 'signal',  label: 'Signals',  route: 'signals' },
  { id: 'chat',    iconKey: 'chat',    label: 'Co-pilot', route: 'chat' },
];

export interface NavRailProps {
  projectId: string;
  /** Explicit override for which item is current. Otherwise inferred from pathname. */
  current?: string;
  /** Badge count shown on the Inbox nav item (pending actions). */
  inboxBadge?: number;
  /** When true, show a pulsing dot on the Co-pilot icon. */
  chatStreaming?: boolean;
}

export function NavRail({ projectId, current, inboxBadge, chatStreaming }: NavRailProps) {
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
      {NAV_ITEMS.map((it) => (
        <NavRailItem
          key={it.id}
          item={it}
          projectId={projectId}
          active={isActive(it)}
          // Inbox tab carries the pending-actions badge — the count is the
          // direct signal of "something needs my review" and surfaces best
          // on the dedicated tab, not on Today's broader dashboard.
          badge={it.id === 'inbox' ? inboxBadge : undefined}
          streaming={it.id === 'chat' ? chatStreaming : undefined}
        />
      ))}
      <div style={{ flex: 1 }} />
      {/* User chip — links to /settings for BYOK + model preferences */}
      <Link
        href="/settings"
        title="Settings"
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
          marginTop: 6,
          textDecoration: 'none',
          cursor: 'pointer',
        }}
      >
        LB
      </Link>
    </div>
  );
}

function NavRailItem({ item, projectId, active, badge, streaming }: { item: NavItem; projectId: string; active: boolean; badge?: number; streaming?: boolean }) {
  return (
    <Link
      href={`/project/${projectId}/${item.route}`}
      title={item.label}
      style={{
        width: 42,
        padding: '8px 0',
        borderRadius: 'var(--r-m)',
        cursor: 'pointer',
        background: active ? 'var(--surface)' : 'transparent',
        boxShadow: active ? 'inset 0 0 0 1px var(--line)' : 'none',
        color: active ? 'var(--ink)' : 'var(--ink-4)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        textDecoration: 'none',
        transition: 'background .12s, color .12s',
        position: 'relative',
      }}
    >
      <Icon d={I[item.iconKey]} size={15} stroke={1.3} />
      {typeof badge === 'number' && badge > 0 && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            minWidth: 14,
            height: 14,
            borderRadius: 7,
            background: 'var(--clay)',
            color: 'var(--on-accent)',
            fontSize: 9,
            fontWeight: 700,
            fontFamily: 'var(--f-mono)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 3px',
            lineHeight: 1,
          }}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {streaming && (
        <span
          className="lp-dot lp-pulse"
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 6,
            height: 6,
            background: 'var(--accent)',
          }}
        />
      )}
      <span
        style={{
          fontSize: 9,
          fontFamily: 'var(--f-mono)',
          letterSpacing: -0.2,
          textTransform: 'uppercase',
        }}
      >
        {item.label}
      </span>
    </Link>
  );
}

