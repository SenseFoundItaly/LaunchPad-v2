/** Execution policy, never a tool-array filter: changing permissions must not
 * change the Anthropic cache prefix. Only the current founder turn can grant
 * permission; historical prices and the model's own offer cannot. */
export function authorizesPricingWrite(message: string): boolean {
  const text = message.trim();
  if (/\b(do not|don't|without|not yet|non|senza)\s+(?:\w+\s+){0,2}(save|saving|write|writing|commit|apply|salvar\w*|scriver\w*|applicar\w*)/i.test(text)) return false;
  if (/\b(propos\w*|draft|bozza|approv\w*)\b/i.test(text)) return false;
  if (/\b(hypothes\w*|ipotesi)\b/i.test(text) && !/\b(save|store|record|commit|salva|registra|imposta)\b/i.test(text)) return false;
  // An explicit imperative, including a polite request. Questions about what
  // was saved or what would happen if a price changed are not imperatives.
  return /^(?:(?:please|per favore)\s+|(?:can|could|would) you\s+|(?:puoi|potresti)\s+)?(?:save|set|update|change|record|store|commit|salva|imposta|aggiorna|cambia|registra)\b[\s\S]*\b(?:pric\w*|anchor|tier\w*|unit economics|currency|subscription|prezz\w*|ancora|fasce|valuta|abbonamento)\b/i.test(text);
}
