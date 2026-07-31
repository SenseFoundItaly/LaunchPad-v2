'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Sidebar nav — workspace switcher, quick search, one accent action, and
 * sectioned nav items with a highlight box that glides to whatever the pointer
 * (or focus) is on.
 *
 * Ported from the Beautiful UI "Sidebar Nav" primitive. Deliberate changes:
 *
 *  1. De-hardcoded. The demo's ITEMS array, its "Creamery Ops / Production
 *     Workspace" header and its baked-in icon map are props now. Icons are
 *     supplied per item by the caller, so this file ships no glyph vocabulary
 *     of its own beyond the chrome (chevrons, search, plus).
 *  2. Removed the fake badge. The source's "New task" button called
 *     `setBadge(n + 1)` — a counter that incremented on click and corresponded
 *     to nothing. `badge` is now a prop; the action button only calls back.
 *  3. The quick-search box in the source stored a query it never used. Here it
 *     actually filters the visible items (and still reports the query upward
 *     via `onSearchChange`), because a search field that does nothing is a lie.
 *  4. The "+" affordance is now a real sibling <button> rather than a <span>
 *     nested inside the row button — nested buttons are invalid HTML and the
 *     source's version wasn't clickable. The row is a wrapper div so the
 *     padding/highlight geometry is unchanged.
 */

export interface SidebarItem {
  key: string;
  /** Nav label. Caller-owned copy — translate it before passing it in. */
  label: string;
  /** Section key this item belongs to. Ignored when `sections` is empty. */
  section?: string;
  /** Leading glyph, typically a 13px inline <svg>. */
  icon?: ReactNode;
  /** Count pill. Undefined = no pill. */
  badge?: number;
  /** Renders the hover "+" affordance for this item. */
  onAdd?: () => void;
}

export interface SidebarSection {
  key: string;
  /** Uppercase section caption. Caller-owned copy. */
  label: string;
}

export interface SidebarWorkspace {
  /** Workspace name. Caller-owned copy. */
  name: string;
  subtitle?: string;
  /** Monogram shown in the square. Defaults to the first letter of `name`. */
  initial?: string;
  onClick?: () => void;
}

interface Props {
  items: SidebarItem[];
  /** Omit for a flat list. */
  sections?: SidebarSection[];
  workspace?: SidebarWorkspace;
  /** Controlled selection. Falls back to internal state (first item). */
  activeKey?: string;
  onSelect?: (key: string) => void;
  /** Accent call-to-action above the items. `label` is caller-owned copy. */
  action?: { label: string; onClick: () => void };
  /** Show the quick-search field. Default true. */
  searchable?: boolean;
  onSearchChange?: (query: string) => void;
}

export function SidebarNav({
  items,
  sections,
  workspace,
  activeKey,
  onSelect,
  action,
  searchable = true,
  onSearchChange,
}: Props) {
  const t = useT();
  const [internalActive, setInternalActive] = useState(items[0]?.key ?? '');
  const [hovered, setHovered] = useState<string | null>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const [query, setQuery] = useState('');
  const navRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const active = activeKey ?? internalActive;

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  const groups: SidebarSection[] = sections?.length
    ? sections
    : [{ key: '__all__', label: '' }];

  // Measure the hovered/active row so the highlight can glide to it — layout
  // effect because it reads geometry that must be settled before paint.
  const targetKey = hovered ?? active;
  useLayoutEffect(() => {
    const container = navRef.current;
    const target = itemRefs.current[targetKey];
    if (!container || !target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    setBox({ top: targetRect.top - containerRect.top, height: targetRect.height });
  }, [targetKey, shown.length]);

  // Search can filter the measured row out from under the highlight; hide it
  // rather than leaving the box parked at a stale offset.
  const boxVisible = Boolean(box) && shown.some((item) => item.key === targetKey);

  const select = (key: string) => {
    if (activeKey === undefined) setInternalActive(key);
    onSelect?.(key);
  };

  return (
    <div className="w-60 rounded-[var(--r-l)] bg-surface p-2" style={{ boxShadow: 'var(--shadow-card)' }}>
      {workspace && (
        <button
          type="button"
          onClick={workspace.onClick}
          aria-label={t('ui.sidebar.switch-workspace')}
          className="mb-1 flex w-full items-center gap-2.5 rounded-[var(--r-s)] p-1.5 text-left transition-[background-color,transform] duration-100 hover:bg-paper-2 active:scale-[0.96]"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-ink text-[13px] font-semibold text-surface">
            {workspace.initial ?? workspace.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-tight font-medium text-ink">{workspace.name}</span>
            {workspace.subtitle && (
              <span className="block truncate text-[11px] leading-tight text-ink-3">{workspace.subtitle}</span>
            )}
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 15l5 5 5-5M7 9l5-5 5 5" />
          </svg>
        </button>
      )}

      {searchable && (
        <label
          className="mb-1 flex h-8 items-center gap-2 rounded-[var(--r-s)] bg-surface-sunk px-2.5"
          style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              onSearchChange?.(event.target.value);
            }}
            placeholder={t('ui.sidebar.search-placeholder')}
            aria-label={t('ui.sidebar.search-label')}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
          />
          <kbd
            className="flex size-4.5 items-center justify-center rounded-[5px] bg-surface text-[10px] text-ink-3"
            style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}
          >
            /
          </kbd>
        </label>
      )}

      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mb-2 flex w-full items-center gap-2 rounded-[var(--r-s)] px-2 py-1.5 text-[13px] font-medium text-accent-ink transition-[background-color,transform] duration-100 hover:bg-accent-wash active:scale-[0.96]"
        >
          <span className="min-w-0 flex-1 truncate text-left">{action.label}</span>
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent text-[color:var(--on-accent)]">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
        </button>
      )}

      {/* items */}
      <div
        ref={navRef}
        onMouseLeave={() => setHovered(null)}
        aria-label={t('ui.sidebar.nav-label')}
        role="navigation"
        className="relative flex flex-col gap-2"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 rounded-[7px] bg-paper-2"
          style={{
            top: box?.top ?? 0,
            height: box?.height ?? 0,
            opacity: boxVisible ? 1 : 0,
            transition:
              'top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease',
          }}
        />
        {groups.map((section) => {
          const sectionItems = sections?.length
            ? shown.filter((item) => item.section === section.key)
            : shown;
          if (sectionItems.length === 0) return null;

          return (
            <div key={section.key}>
              {section.label && (
                <div className="px-2 pt-1 pb-1 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
                  {section.label}
                </div>
              )}
              <div className="flex flex-col gap-px">
                {sectionItems.map((item) => {
                  const isActive = item.key === active;
                  return (
                    <div
                      key={item.key}
                      ref={(el) => {
                        itemRefs.current[item.key] = el;
                      }}
                      onMouseEnter={() => setHovered(item.key)}
                      className="group relative z-10 flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5"
                    >
                      <button
                        type="button"
                        onFocus={() => setHovered(item.key)}
                        onBlur={() => setHovered(null)}
                        onClick={() => select(item.key)}
                        aria-current={isActive ? 'page' : undefined}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left transition-[color,transform] duration-150 active:scale-[0.96]"
                      >
                        {item.icon && (
                          <span className={`flex shrink-0 ${isActive ? 'text-ink' : 'text-ink-3'}`}>{item.icon}</span>
                        )}
                        <span
                          className={`min-w-0 flex-1 truncate text-[13px] transition-colors duration-150 ${
                            isActive ? 'font-medium text-ink' : 'text-ink-2'
                          }`}
                        >
                          {item.label}
                        </span>
                      </button>

                      {item.badge !== undefined && (
                        <span
                          key={item.badge}
                          className={`lp-pop-in flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[10.5px] font-semibold tabular-nums ${
                            isActive ? 'bg-surface text-ink-2' : 'bg-accent-wash text-accent-ink'
                          }`}
                          style={isActive ? { boxShadow: 'inset 0 0 0 1px var(--line)' } : undefined}
                        >
                          {item.badge}
                        </span>
                      )}

                      {item.onAdd && (
                        <button
                          type="button"
                          onClick={item.onAdd}
                          aria-label={t('ui.sidebar.add', { name: item.label })}
                          className="flex size-4.5 items-center justify-center rounded-[5px] text-ink-3 opacity-0 transition-[background-color,color,opacity] duration-100 group-hover:opacity-100 hover:bg-line/70 hover:text-ink-2 focus-visible:opacity-100"
                          style={isActive ? { opacity: 1 } : undefined}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
