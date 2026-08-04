/**
 * Sentinel for option-click handlers whose outcome is "the action did NOT run,
 * and that's fine": founder cancelled the motivation prompt, out-of-credits
 * opened the recharge modal, a prerequisite gate blocked the skill before any
 * spend. The two-outcome contract the renderers had (resolve = ran, reject =
 * broken) could not represent this third case — resolving flipped the button
 * to a false "Done" (and locked the set), rejecting painted a false error.
 * Both option renderers (InlineOption in chat/page.tsx AND OptionSetCard)
 * catch this and reset the button to idle + release the set lock instead.
 */
export class ActionNotRun extends Error {
  readonly silentReset = true;
  constructor(reason: string) {
    super(reason);
    this.name = 'ActionNotRun';
  }
}

/** Duck-typed so it also matches a structurally-equivalent error across chunks. */
export const isSilentReset = (e: unknown): boolean =>
  !!(e as { silentReset?: boolean } | null)?.silentReset;
