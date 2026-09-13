/** A label must not promise an approval that a normal chat reply cannot do.
 * Existing cards without typed actions remain useful as a free review link. */
export function needsApprovalReview(option: {
  label?: string; commit?: unknown; skill_id?: string; navigate_to?: string;
  gate_verdict?: string; loop_verdict?: string; market_scope?: string;
}): boolean {
  const c = option.commit as { canvas?: object; items?: unknown[] } | undefined;
  const hasCommit = !!c && (!!c.canvas && Object.keys(c.canvas).length > 0 || Array.isArray(c.items) && c.items.length > 0);
  return !hasCommit && !option.skill_id && !option.navigate_to && !option.gate_verdict
    && !option.loop_verdict && !option.market_scope
    && /^(approve|apply|confirm|commit|save|approva|applica|conferma|salva)\b/i.test(option.label?.trim() ?? '');
}
