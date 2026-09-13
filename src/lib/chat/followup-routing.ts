/** The cheap namespace is for acknowledgements, not arbitrary short requests.
 * An affirmative reply to an analysis offer needs the normal tool superset.
 * Neither path mutates its tools based on the text of this turn. */
export function isSimpleFollowUp(message: string, messages: unknown[]): boolean {
  if (messages.length <= 1) return false;
  const text = message.trim();
  if (/^(thanks|thank you|thx|ty|got it|cool|nice|grazie|capito)$/i.test(text)) return true;
  // Affirmations can authorize a previously offered action in any language:
  // "Shall I compare the options?" → "yes". An action-word denylist cannot
  // establish that no tools/artifacts are needed. Keep those turns on the
  // normal stable tool superset; only explicit acknowledgements route cheaply.
  return false;
}
