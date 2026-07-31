'use client';

import { useRef, useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Chat composer — a compact conversation panel: optional tabs, the founder's
 * last prompt as a right-aligned bubble, agent trace sections, and an input.
 *
 * Ported from the Beautiful UI "Chat" primitive onto the SenseFound tokens.
 * Deliberate changes from the source:
 *
 *  1. The scripted reply timeline is GONE. The original walked a `Phase` state
 *     machine on setTimeout (sent → reply1 @500ms → reply2 @1400ms → done) so
 *     the demo appeared to answer whatever you typed. Nothing here fakes a
 *     reply: `userMessage` and `sections` are props, and `onSend` is the
 *     caller's problem.
 *  2. Tabs, header actions and the ice-cream fixtures are props too — the
 *     component ships no content of its own.
 *  3. The only local state left is the draft input, which is genuinely
 *     interactive.
 *
 * The conversation region is a fixed-height scroller on purpose: the card must
 * not resize under the composer while an answer streams in.
 */

export interface ChatTab {
  id: string;
  /** Already localised by the caller. */
  label: string;
}

export interface ChatAction {
  id: string;
  /** Already localised by the caller — used as the button's accessible name. */
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
}

export interface ChatSection {
  id: string;
  /** Bold lead-in, e.g. the tool or skill that ran. */
  label: string;
  /** Muted qualifier after the label. */
  sub?: string;
  /** How long the step took, e.g. "4s". Rendered as "for 4s". */
  duration?: string;
  body: string;
  /** True while this section is still being superseded — dims and blurs it. */
  resolving?: boolean;
}

export interface ChatComposerProps {
  /** Sent when the founder submits; the component clears the draft itself. */
  onSend: (text: string) => void;
  /** The last submitted prompt. Omit to render no bubble. */
  userMessage?: string;
  sections?: ChatSection[];
  tabs?: ChatTab[];
  activeTabId?: string;
  onTabChange?: (id: string) => void;
  actions?: ChatAction[];
  /** Overrides the default input placeholder. */
  placeholder?: string;
  /** Blocks sending (e.g. a turn is in flight, or credits are exhausted). */
  disabled?: boolean;
}

function Section({ section, durationLabel }: { section: ChatSection; durationLabel?: string }) {
  return (
    <div
      className="lp-rise flex w-full flex-col gap-1.5 transition-[opacity,filter,transform] duration-400"
      style={{
        opacity: section.resolving ? 0.55 : 1,
        filter: section.resolving ? 'blur(0.5px)' : 'blur(0)',
        transform: section.resolving ? 'scale(0.985)' : 'scale(1)',
        transformOrigin: 'top left',
        transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
      }}
    >
      <div className="flex items-center gap-1 text-[12px] leading-[1.3]">
        <span className="font-medium text-ink">{section.label}</span>
        {section.sub && <span className="text-ink-2">{section.sub}</span>}
        {durationLabel && <span className="text-ink">{durationLabel}</span>}
      </div>
      <p className="text-[13px] leading-normal text-ink">{section.body}</p>
    </div>
  );
}

export function ChatComposer({
  onSend,
  userMessage,
  sections = [],
  tabs = [],
  activeTabId,
  onTabChange,
  actions = [],
  placeholder,
  disabled = false,
}: ChatComposerProps) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const canSend = !disabled && draft.trim().length > 0;
  const showHeader = tabs.length > 0 || actions.length > 0;

  const send = () => {
    if (!canSend) return;
    onSend(draft.trim());
    setDraft('');
  };

  return (
    <div
      className="flex h-[288px] w-full max-w-95 flex-col self-start overflow-hidden rounded-[var(--r-l)] bg-surface"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      {showHeader && (
        <div className="flex shrink-0 items-center justify-between border-b border-line p-1.5">
          <div className="flex items-center">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === activeTabId}
                onClick={() => onTabChange?.(item.id)}
                className={`rounded-[var(--r-m)] px-2 py-[3px] text-[13px] text-ink transition-[background-color,opacity] duration-100 ${
                  item.id === activeTabId ? 'bg-paper-2' : 'opacity-50 hover:opacity-75'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                aria-label={action.label}
                onClick={action.onClick}
                className="flex size-6 items-center justify-center rounded-[var(--r-m)] text-ink-3 transition-colors duration-100 hover:bg-paper-2 hover:text-ink-2"
              >
                {action.icon}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* conversation — fixed region so the card never changes shape */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pt-2.5 pb-1">
        {userMessage && (
          <div className="flex justify-end pl-14">
            <div className="lp-rise rounded-xl bg-paper-2 px-3 py-1.5 text-[13px] leading-[1.4] text-ink">
              {userMessage}
            </div>
          </div>
        )}

        {sections.map((section) => (
          <Section
            key={section.id}
            section={section}
            durationLabel={
              section.duration ? t('ui.chat.section-duration', { d: section.duration }) : undefined
            }
          />
        ))}
      </div>

      {/* composer */}
      <div className="mt-auto shrink-0 p-1.5">
        <div
          role="presentation"
          onClick={() => inputRef.current?.focus()}
          className="flex cursor-text flex-col gap-2 rounded-[var(--r-s)] border border-line bg-paper-2 p-2.5 transition-[border-color,box-shadow] duration-150 focus-within:border-line-2"
          style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.035)' }}
        >
          <input
            ref={inputRef}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={placeholder ?? t('ui.chat.placeholder')}
            aria-label={t('ui.chat.prompt')}
            className="min-h-4.5 bg-transparent text-[13px] leading-[1.4] text-ink outline-none placeholder:text-ink-3"
          />
          <div className="flex items-center justify-end">
            <button
              type="button"
              aria-label={t('ui.chat.send')}
              disabled={!canSend}
              onClick={send}
              className="flex size-7 items-center justify-center rounded-[var(--r-m)] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96]"
              style={{
                background: canSend ? 'var(--ink)' : 'var(--line-2)',
                color: canSend ? 'var(--surface)' : 'var(--ink-2)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
