/**
 * Design-system chrome — TopBar + NavRail.
 *
 * Two-section nav:
 *
 *   PRIMARY (top):
 *     dashboard → /project/{id}/today  (project stage + todos + signal log)
 *
 *   CHANNELS (bottom):
 *     inbox     → /project/{id}/actions    (pending actions)
 *     signals   → /project/{id}/signals    (briefs + findings)
 *     knowledge → /project/{id}/knowledge  (uploads)
 *     chat      → /project/{id}/chat       (Co-pilot — chat + single-scroll
 *                                           Canvas, grouped by department)
 *
 * Departments still live as data in src/lib/departments.ts — they own
 * tables and chat-tool prefixes — but they no longer have their own
 * routes. The Canvas is one department-grouped scroll inside the
 * Co-pilot (the facet tabs were removed in the 2026-06 simplification);
 * Canvas as a concept lives in the chat page, not the sidebar.
 */

'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, I, type IconKey } from './icons';
import { ShareButton } from '@/components/project/ShareButton';
import { CreditsBadge } from '@/components/CreditsBadge';
import { LanguageSwitch } from '@/components/design/LanguageSwitch';
import { ThemeToggle } from '@/components/design/ThemeToggle';
import { Logomark } from '@/components/design/Logomark';
import { useKnowledgeCount } from '@/hooks/useKnowledgeCount';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';

// =============================================================================
// TopBar — 38px, brand mark + breadcrumbs + right slot
// =============================================================================

export interface TopBarProps {
  breadcrumb?: string[];
  right?: React.ReactNode;
  /** When set, renders a Share button on the right that opens the per-project
   *  sharing dialog. Optional so non-project surfaces (login, projects index)
   *  can omit it. Renders BEFORE the page's `right` content so positional
   *  ordering stays consistent across pages. */
  projectId?: string;
  /** Legacy prop from design — accepted but ignored; theme is global. */
  theme?: 'paper' | 'ink';
}

export function TopBar({ breadcrumb, right, projectId }: TopBarProps) {
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
        {/* Brand mark — SenseFound logomark + wordmark (V1.1 guidelines: the
            protective bracket + validation arrow is the brand's identity). The
            logomark links home; the wordmark is hidden on narrow widths. */}
        <a href="/" aria-label="LaunchPad — home" style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none', flexShrink: 0 }}>
          {/* SenseFound logomark (brand symbol) + LaunchPad wordmark (product
              name). 22px = the brand's documented minimum logo size (p.12). */}
          <Logomark size={22} />
          {/* Wordmark in the display/sans face (Safiro stand-in), NOT mono —
              the brand wordmark is a grotesque semibold, uppercase, tight. */}
          <span
            style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 700, letterSpacing: '.02em', color: 'var(--ink)' }}
          >
            LAUNCHPAD
          </span>
        </a>
        {breadcrumb && breadcrumb.length > 0 && (
          <span style={{ color: 'var(--ink-6)', margin: '0 2px' }}>·</span>
        )}
        {breadcrumb && breadcrumb.length > 0 && (
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
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-4)' }}>
        {projectId && <ShareButton projectId={projectId} />}
        {right}
        <LanguageSwitch readOnly={!!projectId} />
        {/* CreditsBadge sits *after* page-supplied `right` content so the
            credits chip is always pinned to the far right — making the
            credit balance the founder's most-visible header signal. The
            badge owns its own TanStack cache + event-bridge subscription,
            so mounting it globally costs one query per project per session
            (no per-route re-fetch). The title-wrapping span keeps the
            tooltip in chrome.tsx without touching CreditsBadge itself. */}
        {projectId && (
          <span title="Credits — your project's monthly budget">
            <CreditsBadge projectId={projectId} />
          </span>
        )}
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
  /** i18n key for the micro label — resolved via useT() at render. */
  labelKey: MessageKey;
  /** Path segment after /project/{id}/ — e.g. 'dashboard', 'chat' */
  route: string;
  /** If true, highlight when pathname segment matches `route` loosely */
  fuzzy?: boolean;
  /** i18n key for the longer hover tooltip. Falls back to label when omitted. */
  tooltipKey?: MessageKey;
}

// Primary nav — the project landing surface (project stage + todos + signal log).
const PRIMARY_ITEMS: NavItem[] = [
  { id: 'dashboard', iconKey: 'home', labelKey: 'nav.home', route: 'today',
    tooltipKey: 'nav.home.tooltip' },
];

// Channels — cross-cutting activity surfaces shown below the divider.
// Phase 1 consolidation (2026-06): the dedicated Signals nav was removed —
// signal_alert + intelligence_brief now materialize into the Inbox, so the
// channel is collapsed into the single proposal queue.
const CHANNEL_ITEMS: NavItem[] = [
  { id: 'inbox',     iconKey: 'tickets', labelKey: 'nav.inbox',     route: 'actions',
    tooltipKey: 'nav.inbox.tooltip' },
  { id: 'knowledge', iconKey: 'book',    labelKey: 'nav.knowledge', route: 'knowledge',
    tooltipKey: 'nav.knowledge.tooltip' },
  { id: 'financial', iconKey: 'dollar',  labelKey: 'nav.financial', route: 'financial',
    tooltipKey: 'nav.financial.tooltip' },
  { id: 'chat',      iconKey: 'chat',    labelKey: 'nav.copilot',   route: 'chat',
    tooltipKey: 'nav.copilot.tooltip' },
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
  const t = useT();
  // Self-fetched (cached + shared across pages) so the "Know" count shows on
  // every surface without each page having to thread it down as a prop.
  const { count: knowledgeCount } = useKnowledgeCount(projectId);

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
      {PRIMARY_ITEMS.map((it) => (
        <NavRailItem
          key={it.id}
          item={it}
          label={t(it.labelKey)}
          tooltip={it.tooltipKey ? t(it.tooltipKey) : undefined}
          projectId={projectId}
          active={isActive(it)}
        />
      ))}
      {/* Divider — separates departments (where you work) from channels
          (how you triage). 1px line, inset 8px on each side. */}
      <div
        aria-hidden
        style={{
          width: 28,
          height: 1,
          background: 'var(--line)',
          margin: '6px 0',
          flexShrink: 0,
        }}
      />
      {CHANNEL_ITEMS.map((it) => (
        <NavRailItem
          key={it.id}
          item={it}
          label={t(it.labelKey)}
          tooltip={it.tooltipKey ? t(it.tooltipKey) : undefined}
          projectId={projectId}
          active={isActive(it)}
          badge={it.id === 'inbox' ? inboxBadge : it.id === 'knowledge' ? knowledgeCount : undefined}
          // Inbox badge = items needing action (urgent → clay). The Know badge
          // is just an informational item count (neutral), not an alert.
          badgeTone={it.id === 'knowledge' ? 'count' : 'alert'}
          streaming={it.id === 'chat' ? chatStreaming : undefined}
        />
      ))}
      {/* flexShrink:0 so a short viewport collapses THIS spacer (not the chip). */}
      <div style={{ flex: 1, minHeight: 6 }} />
      {/* Light/dark theme toggle — sits at the bottom of the rail, above the
          account chip. Token-driven, so it re-themes the whole app instantly. */}
      <ThemeToggle />
      {/* User chip — links to /settings for BYOK + model preferences.
          flexShrink:0 keeps the 28px chip from being squeezed to nothing on a
          short rail (item 3: the account/settings icon "sometimes disappears"). */}
      <Link
        href="/settings"
        title={t('nav.settings')}
        style={{
          flexShrink: 0,
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

function NavRailItem({ item, label, tooltip, projectId, active, badge, badgeTone = 'alert', streaming }: { item: NavItem; label: string; tooltip?: string; projectId: string; active: boolean; badge?: number; badgeTone?: 'alert' | 'count'; streaming?: boolean }) {
  const isCount = badgeTone === 'count';
  return (
    <Link
      href={`/project/${projectId}/${item.route}`}
      title={tooltip ?? label}
      data-tour={`nav-${item.id}`}
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
            background: isCount ? 'var(--paper-3)' : 'var(--clay)',
            color: isCount ? 'var(--ink-4)' : 'var(--on-accent)',
            border: isCount ? '1px solid var(--line)' : 'none',
            boxSizing: 'border-box',
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
        {label}
      </span>
    </Link>
  );
}

