/** Explicit format requests are repeated next to the current turn, after the
 * stable cached rules. This changes no tools and grants no write permission. */
export function responseContract(message: string): string {
  const sentences = message.match(/\b(one|two|three|1|2|3) sentences?\b|\b(un[ao]?|due|tre|1|2|3) fras[ei]\b/i);
  const count = sentences ? ({ one: 1, two: 2, three: 3, un: 1, una: 1, uno: 1, due: 2, tre: 3 } as Record<string, number>)[(sentences[1] ?? sentences[2]).toLowerCase()] ?? Number(sentences[1] ?? sentences[2]) : null;
  const words = message.match(/(?:under|fewer than|at most|maximum|massimo|meno di)\s+(\d{1,3})\s+(?:words|parole)/i)?.[1];
  const bullets = message.match(/\b(one|two|three|1|2|3) (?:short )?bullets?\b|\b(un[ao]?|due|tre|1|2|3) (?:brevi )?punti\b/i);
  return [
    'Use plain founder-facing language. Never expose internal context block names, proposal IDs, database field names or underscore-separated keys in prose.',
    count ? `Return exactly ${count} sentences TOTAL. No preface, extra explanation, artifact, option buttons, or outro. Answer directly.` : '',
    words ? `Keep the ENTIRE visible response under ${words} words, including any introduction or ending.` : '',
    bullets ? `Return only ${bullets[1] ?? bullets[2]} short bullets TOTAL, with no introduction, outro, cards or extra tasks.` : '',
    /\b(recall|remember|earlier|saved|salvat\w*|ricord\w*)\b/i.test(message) ? 'Before answering, read the current CONVERSATION RECALL, CURRENT IDEA CANVAS and CONFIRMED FOUNDER APPROVALS blocks. They supersede older assistant statements about missing memory or pending proposals. Use read_chat_history before claiming an earlier detail cannot be recalled. Report current saved state without asking to approve it again.' : '',
    /(?:one|a|una?|sola?)\s+(?:compact\s+|comparison\s+|sola\s+|compatta\s+){0,2}(?:table|tabella)\b|\b(?:table|tabella) only\b/i.test(message) ? 'Return ONE table artifact only. Put assumptions, calculated results and any requested missing inputs inside its rows. No prose outside the table, options, introduction or outro.' : '',
    /\b(observ\w*|osserv\w*|ho visto|I saw)\b/i.test(message) ? 'Preserve the observation exactly: one shop is one shop, unsold is not discarded, and no missed sales, frequency or consequence was observed unless the founder said so. Any broader problem wording must be explicitly a hypothesis.' : '',
    /(?:no|without|senza)\s+(?:saving|save|salvare|salvataggi)/i.test(message) ? 'Discussion only: do not call a write tool or suggest a save unless asked later.' : '',
  ].filter(Boolean).join('\n');
}
