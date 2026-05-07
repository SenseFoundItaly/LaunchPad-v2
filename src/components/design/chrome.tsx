/**
 * Design-system chrome — TopBar + NavRail.
 *
 * The NavRail is wired to Next.js Link so nav items are real routes:
 *   home → /project/{id}/dashboard
 *   chat → /project/{id}/chat
 *   signals → /project/{id}/signals
 *   inbox → /project/{id}/actions
 *
 * Secondary routes live behind a "More" popover pinned above the user chip:
 *   graph → /project/{id}/intelligence
 *   pipe → /project/{id}/workflow
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
  { id: 'signals', iconKey: 'signal',  label: 'Signals',  route: 'signals' },
  { id: 'inbox',   iconKey: 'tickets', label: 'Inbox',    route: 'actions' },
];

const MORE_ITEMS: NavItem[] = [
  { id: 'graph', iconKey: 'graph', label: 'Intelligence', route: 'intelligence' },
  { id: 'pipe',  iconKey: 'pipe',  label: 'Pipeline',     route: 'workflow' },
  { id: 'fund',  iconKey: 'fund',  label: 'Raise',        route: 'fundraising' },
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
      {NAV_ITEMS.map((it) => (
        <NavRailItem key={it.id} item={it} projectId={projectId} active={isActive(it)} />
      ))}
      <div style={{ flex: 1 }} />
      {/* More menu — opens popover with secondary nav items */}
      <MoreMenu projectId={projectId} isActive={isActive} />
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
          marginTop: 6,
        }}
      >
        LB
      </div>
    </div>
  );
}

function NavRailItem({ item, projectId, active }: { item: NavItem; projectId: string; active: boolean }) {
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
      }}
    >
      <Icon d={I[item.iconKey]} size={15} stroke={1.3} />
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

function MoreMenu({ projectId, isActive }: { projectId: string; isActive: (item: NavItem) => boolean }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Any MORE_ITEMS route active → highlight the More button
  const moreActive = MORE_ITEMS.some(isActive);

  React.useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="More"
        style={{
          width: 42,
          padding: '8px 0',
          borderRadius: 'var(--r-m)',
          cursor: 'pointer',
          background: open || moreActive ? 'var(--surface)' : 'transparent',
          boxShadow: open || moreActive ? 'inset 0 0 0 1px var(--line)' : 'none',
          color: open || moreActive ? 'var(--ink)' : 'var(--ink-4)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
          border: 'none',
          transition: 'background .12s, color .12s',
          fontFamily: 'inherit',
        }}
      >
        <Icon d={I.more} size={15} stroke={1.3} />
        <span
          style={{
            fontSize: 9,
            fontFamily: 'var(--f-mono)',
            letterSpacing: -0.2,
            textTransform: 'uppercase',
          }}
        >
          More
        </span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            left: 50,
            bottom: 0,
            width: 180,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-m)',
            boxShadow: '0 4px 16px rgba(0,0,0,.12)',
            padding: '6px 0',
            zIndex: 100,
          }}
        >
          {MORE_ITEMS.map((it) => {
            const on = isActive(it);
            return (
              <Link
                key={it.id}
                href={`/project/${projectId}/${it.route}`}
                onClick={() => setOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 14px',
                  textDecoration: 'none',
                  color: on ? 'var(--ink)' : 'var(--ink-3)',
                  fontWeight: on ? 600 : 400,
                  fontSize: 12,
                  fontFamily: 'var(--f-sans)',
                  background: on ? 'var(--paper-2)' : 'transparent',
                  transition: 'background .1s',
                }}
              >
                <Icon d={I[it.iconKey]} size={14} stroke={1.2} />
                {it.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
