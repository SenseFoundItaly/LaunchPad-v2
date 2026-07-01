/**
 * Design-system chrome — TopBar + NavRail.
 *
 * Information architecture: the **7-stage journey spine is the backbone/home**
 * (`today`). Solve / Build / Intelligence are GLOBAL working modes that serve
 * the spine — work done in a mode auto-attributes to the founder's active
 * stage and its evidence flows back onto that stage's card. The spine is never
 * demoted to a peer of the modes: it is reachable everywhere via the rail's
 * home control and a persistent **active-stage pill** in the TopBar (which
 * doubles as "return to spine").
 *
 *   TopBar (44px):  [Logomark LAUNCHPAD]  [active-stage pill → today]
 *                   [ Solve · Build · Intelligence ]  breadcrumb  …  right-slot
 *   NavRail (48px): brand→spine · per-mode icon nav (journey mode → 7-stage
 *                   mini-spine) · settings chip
 *
 * `mode` is DERIVED from the route segment (`modeForSegment`) — existing routes
 * keep working; the mode layer is purely additive. New Intelligence/Build
 * routes are wired into `RAIL_BY_MODE` / `MODE_DEFAULT_ROUTE` as those phases
 * land (marked below).
 */

'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, I, type IconKey } from './icons';
import { Pill } from './primitives';
import { ShareButton } from '@/components/project/ShareButton';
import { CreditsBadge } from '@/components/CreditsBadge';
import { HIDE_CREDITS } from '@/lib/credit-costs';
import { LanguageSwitch } from '@/components/design/LanguageSwitch';
import { Logomark } from '@/components/design/Logomark';
import { useKnowledgeCount } from '@/hooks/useKnowledgeCount';
import { useStages } from '@/hooks/useStages';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';

// =============================================================================
// Modes — the spine is `journey` (home); Solve/Build/Intelligence are the
// working modes shown as TopBar tabs. Mode is derived from the route segment.
// =============================================================================

export type Mode = 'journey' | 'solve' | 'build' | 'intelligence';

const SEGMENT_MODE: Record<string, Mode> = {
  today: 'journey',
  chat: 'solve',
  knowledge: 'solve',
  // Inbox/watchers + activity live under Intelligence (signals feed it).
  actions: 'intelligence',
  signals: 'intelligence',
  monitors: 'intelligence',
  assumptions: 'intelligence',
  usage: 'intelligence',
  intelligence: 'intelligence', // Phase 4 competitor/briefs/signals routes
  financial: 'build',
  build: 'build', // Phase 6 3-pane
};

export function modeForSegment(seg: string): Mode {
  return SEGMENT_MODE[seg] ?? 'journey';
}

// Default route each mode tab lands on. Intelligence/Build point at existing
// routes until their dedicated surfaces land (Phase 4 → 'intelligence',
// Phase 6 → 'build'), so a tab never 404s mid-migration.
export const MODE_DEFAULT_ROUTE: Record<Mode, string> = {
  journey: 'today',
  solve: 'chat',
  intelligence: 'intelligence',
  build: 'build',
};

// Working-mode tabs (journey is home, not a tab). Labels are product
// proper-nouns — kept literal rather than routed through i18n.
const MODE_TABS: { mode: Exclude<Mode, 'journey'>; label: string }[] = [
  { mode: 'solve', label: 'Solve' },
  { mode: 'build', label: 'Build' },
  { mode: 'intelligence', label: 'Intelligence' },
];

interface NavItem {
  id: string;
  iconKey: IconKey;
  /** Path segment after /project/{id}/ */
  route: string;
  /** i18n key for the tooltip label (falls back to `label`/id). */
  labelKey?: MessageKey;
  /** Literal tooltip label when there's no i18n key yet. */
  label?: string;
  tooltipKey?: MessageKey;
}

// Per-mode rail item sets. `journey` is special-cased into a 7-stage mini
// spine (see JourneyRail). New routes get appended here in their phase.
const RAIL_BY_MODE: Record<Mode, NavItem[]> = {
  journey: [],
  solve: [
    { id: 'chat', iconKey: 'chat', route: 'chat', labelKey: 'nav.copilot', tooltipKey: 'nav.copilot.tooltip' },
    { id: 'knowledge', iconKey: 'book', route: 'knowledge', labelKey: 'nav.knowledge', tooltipKey: 'nav.knowledge.tooltip' },
  ],
  intelligence: [
    { id: 'competitor', iconKey: 'signal', route: 'intelligence', label: 'Competitors' },
    { id: 'briefs', iconKey: 'flag', route: 'intelligence/briefs', label: 'Daily briefs' },
    { id: 'feed', iconKey: 'history', route: 'intelligence/signals', label: 'All signals' },
    { id: 'inbox', iconKey: 'tickets', route: 'actions', labelKey: 'nav.inbox', tooltipKey: 'nav.inbox.tooltip' },
  ],
  build: [
    { id: 'build', iconKey: 'layers', route: 'build', label: 'Build' },
    { id: 'financial', iconKey: 'dollar', route: 'financial', labelKey: 'nav.financial', tooltipKey: 'nav.financial.tooltip' },
  ],
};

// =============================================================================
// TopBar — 44px: brand + active-stage pill + mode tabs + breadcrumb + right
// =============================================================================

export interface TopBarProps {
  breadcrumb?: string[];
  right?: React.ReactNode;
  /** When set, renders the Share button + credits badge and enables the
   *  in-project chrome (active-stage pill, mode tabs). Omitted on non-project
   *  surfaces (projects index, login). */
  projectId?: string;
  /** Active product mode (derived from the route in the project layout). Only
   *  rendered when `projectId` is also present. */
  mode?: Mode;
  /** Legacy prop from design — accepted but ignored; theme is global. */
  theme?: 'paper' | 'ink';
}

export function TopBar({ breadcrumb, right, projectId, mode }: TopBarProps) {
  const inProject = !!projectId && !!mode;
  return (
    <div
      style={{
        height: 44,
        flexShrink: 0,
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        {/* Brand — SenseFound logomark (bracket + arrow) + LaunchPad wordmark.
            Links to the projects index. 22px = brand's documented minimum. */}
        <a href="/" aria-label="LaunchPad — home" style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none', flexShrink: 0 }}>
          <Logomark size={22} />
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 700, letterSpacing: '.02em', color: 'var(--ink)' }}>
            LAUNCHPAD
          </span>
        </a>
        {/* Active-stage pill — the spine is home; this shows which stage the
            current work attributes to, and returns to the spine on click. */}
        {inProject && <ActiveStagePill projectId={projectId!} />}
        {/* Mode tabs — global working surfaces (journey/home is not a tab). */}
        {inProject && <ModeTabs projectId={projectId!} mode={mode!} />}
        {breadcrumb && breadcrumb.length > 0 && (
          <>
            <span style={{ color: 'var(--ink-6)', margin: '0 1px' }}>·</span>
            <span
              style={{
                fontSize: 12,
                color: 'var(--ink-3)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                minWidth: 0,
                overflow: 'hidden',
              }}
            >
              {breadcrumb.map((b, i) => (
                <React.Fragment key={`${b}-${i}`}>
                  {i > 0 && <Icon d={I.chevr} size={10} style={{ opacity: 0.5, flexShrink: 0 }} />}
                  <span
                    style={{
                      color: i === breadcrumb.length - 1 ? 'var(--ink)' : 'var(--ink-4)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {b}
                  </span>
                </React.Fragment>
              ))}
            </span>
          </>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-4)', flexShrink: 0 }}>
        {projectId && <ShareButton projectId={projectId} />}
        {right}
        <LanguageSwitch />
        {projectId && !HIDE_CREDITS && (
          <span title="Credits — your project's monthly budget">
            <CreditsBadge projectId={projectId} />
          </span>
        )}
      </div>
    </div>
  );
}

/** Active-stage pill — reads the shared /stages query (deduped with the spine),
 *  so it costs no extra fetch. Shows the active stage (or the first pending /
 *  last stage as fallback) and links back to the spine. */
function ActiveStagePill({ projectId }: { projectId: string }) {
  const { data: stages } = useStages(projectId);
  if (!stages || stages.length === 0) return null;
  const active =
    stages.find((s) => s.status === 'active') ??
    stages.find((s) => s.status === 'pending') ??
    stages[stages.length - 1];
  if (!active) return null;
  const label = active.stage.label.length > 22 ? `${active.stage.label.slice(0, 22)}…` : active.stage.label;
  return (
    <Link
      href={`/project/${projectId}/today`}
      title="Journey — return to the spine"
      style={{ textDecoration: 'none', flexShrink: 0 }}
    >
      <Pill kind="live" dot>
        S{active.stage.number} · {label}
      </Pill>
    </Link>
  );
}

/** Mode tabs — Solve / Build / Intelligence. Active tab matches the NavRail
 *  active treatment (surface fill + inset hairline) for a consistent language. */
function ModeTabs({ projectId, mode }: { projectId: string; mode: Mode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      {MODE_TABS.map((tab) => {
        const active = mode === tab.mode;
        return (
          <Link
            key={tab.mode}
            href={`/project/${projectId}/${MODE_DEFAULT_ROUTE[tab.mode]}`}
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--r-s)',
              fontSize: 12,
              fontFamily: 'var(--f-mono)',
              textTransform: 'uppercase',
              letterSpacing: 0.3,
              textDecoration: 'none',
              color: active ? 'var(--ink)' : 'var(--ink-4)',
              background: active ? 'var(--surface)' : 'transparent',
              boxShadow: active ? 'inset 0 0 0 1px var(--line)' : 'none',
              transition: 'color .12s, background .12s',
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

// =============================================================================
// NavRail — 48px left icon rail; per-mode item sets; journey = 7-stage spine
// =============================================================================

export interface NavRailProps {
  projectId: string;
  /** Active mode; defaults to the spine home. */
  mode?: Mode;
  /** Explicit override for which item is current (else inferred from pathname). */
  current?: string;
  /** Badge count shown on the Inbox nav item (pending actions). */
  inboxBadge?: number;
  /** When true, show a pulsing dot on the Co-pilot icon. */
  chatStreaming?: boolean;
}

export function NavRail({ projectId, mode = 'journey', current, inboxBadge, chatStreaming }: NavRailProps) {
  const pathname = usePathname() || '';
  const t = useT();
  const { count: knowledgeCount } = useKnowledgeCount(projectId);

  const items = RAIL_BY_MODE[mode] ?? [];

  // Current sub-path after /project/{id}/ (e.g. 'intelligence/briefs').
  const currentSub = pathname.split('/').slice(3).join('/');
  // Longest-prefix match so 'intelligence/briefs' activates the briefs item,
  // not the shorter 'intelligence' (competitor) item.
  const activeId = current
    ? current
    : items
        .filter((it) => currentSub === it.route || currentSub.startsWith(`${it.route}/`))
        .sort((a, b) => b.route.length - a.route.length)[0]?.id;

  return (
    <div
      style={{
        width: 48,
        flexShrink: 0,
        borderRight: '1px solid var(--line)',
        background: 'var(--paper-2)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 0',
        gap: 3,
      }}
    >
      {/* Brand mark = home/spine control. Returns to this project's journey. */}
      <Link
        href={`/project/${projectId}/today`}
        title="Journey — the spine"
        aria-label="Journey"
        style={{
          width: 40,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textDecoration: 'none',
          color: mode === 'journey' ? 'var(--ink)' : 'var(--ink-3)',
        }}
      >
        <Logomark size={18} />
      </Link>
      <div aria-hidden style={{ width: 28, height: 1, background: 'var(--line)', margin: '3px 0 5px', flexShrink: 0 }} />

      {mode === 'journey' ? (
        <JourneyRail projectId={projectId} />
      ) : (
        items.map((it) => (
          <NavRailItem
            key={it.id}
            item={it}
            tooltip={it.tooltipKey ? t(it.tooltipKey) : it.labelKey ? t(it.labelKey) : it.label ?? it.id}
            projectId={projectId}
            active={activeId === it.id}
            badge={it.id === 'inbox' ? inboxBadge : it.id === 'knowledge' ? knowledgeCount : undefined}
            badgeTone={it.id === 'knowledge' ? 'count' : 'alert'}
            streaming={it.id === 'chat' ? chatStreaming : undefined}
          />
        ))
      )}

      <div style={{ flex: 1, minHeight: 6 }} />
      {/* User chip → settings (BYOK + model preferences). */}
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

/** Journey mode rail — a vertical 7-stage mini-spine. Each stage links back to
 *  the spine (today); status drives the colour (done = moss, active = accent,
 *  pending = muted). Reads the shared /stages query (deduped with the pill). */
function JourneyRail({ projectId }: { projectId: string }) {
  const { data: stages } = useStages(projectId);
  const list = stages ?? [];
  if (list.length === 0) {
    // No stages yet — fall back to a single home affordance.
    return (
      <Link
        href={`/project/${projectId}/today`}
        title="Home"
        style={{ width: 40, height: 40, borderRadius: 'var(--r-m)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', background: 'var(--surface)', boxShadow: 'inset 0 0 0 1px var(--line)', textDecoration: 'none' }}
      >
        <Icon d={I.home} size={16} stroke={1.4} />
      </Link>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {list.map((s) => {
        const color =
          s.status === 'done' ? 'var(--moss)' : s.status === 'active' ? 'var(--accent)' : 'var(--ink-5)';
        return (
          <Link
            key={s.stage.id}
            href={`/project/${projectId}/today`}
            title={`Stage ${s.stage.number} · ${s.stage.label} — ${s.passed}/${s.total}`}
            style={{
              width: 30,
              height: 30,
              borderRadius: 'var(--r-m)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
              border: s.status === 'active' ? '1px solid var(--accent)' : '1px solid transparent',
              background: s.status === 'active' ? 'var(--surface)' : 'transparent',
            }}
          >
            <span className="lp-mono" style={{ fontSize: 11, fontWeight: 600, color }}>
              {s.stage.number}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function NavRailItem({
  item,
  tooltip,
  projectId,
  active,
  badge,
  badgeTone = 'alert',
  streaming,
}: {
  item: NavItem;
  tooltip?: string;
  projectId: string;
  active: boolean;
  badge?: number;
  badgeTone?: 'alert' | 'count';
  streaming?: boolean;
}) {
  const isCount = badgeTone === 'count';
  return (
    <Link
      href={`/project/${projectId}/${item.route}`}
      title={tooltip}
      style={{
        width: 40,
        height: 40,
        borderRadius: 'var(--r-m)',
        cursor: 'pointer',
        background: active ? 'var(--surface)' : 'transparent',
        boxShadow: active ? 'inset 0 0 0 1px var(--line)' : 'none',
        color: active ? 'var(--ink)' : 'var(--ink-4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textDecoration: 'none',
        transition: 'background .12s, color .12s',
        position: 'relative',
      }}
    >
      <Icon d={I[item.iconKey]} size={16} stroke={1.4} />
      {typeof badge === 'number' && badge > 0 && (
        <span
          style={{
            position: 'absolute',
            top: 3,
            right: 3,
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
          style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, background: 'var(--accent)' }}
        />
      )}
    </Link>
  );
}
