/**
 * Map an open validation check's label to an actionable co-pilot prompt.
 * Keyword-matched (robust to check-id / label changes). Shared by the chat
 * empty-state briefing, the project-brief endpoint, and the clickable
 * SpineSection substeps — so "click an unmet substep → pre-fill chat" and the
 * briefing's next steps always phrase the ask the same way.
 *
 * Pure + dependency-free → safe in both client components and server routes.
 */
export function checkActionPrompt(label: string): string {
  const l = label.toLowerCase();
  if (/segment|icp|ideal customer|persona|beachhead/.test(l)) return 'Help me define and validate my target customer segment.';
  if (/competitor/.test(l)) return 'Research and map my top competitors.';
  if (/interview/.test(l)) return "Help me log customer interviews — I'll tell you who I spoke to and what they said.";
  if (/watcher|monitor/.test(l)) return 'Set up a watcher on my key competitors or market trends.';
  if (/market size|\btam\b|\bsam\b|\bsom\b/.test(l)) return 'Help me size my market (TAM / SAM / SOM).';
  if (/channel|acquisition|reach|distribution/.test(l)) return 'Help me identify my acquisition channels.';
  if (/business model|revenue|pricing|unit econ|tier|willingness|anchor price/.test(l)) return 'Help me define my business model and pricing.';
  if (/differentiat|competitive|edge|advantage/.test(l)) return "Help me articulate how I'm different from competitors.";
  if (/value prop/.test(l)) return 'Help me sharpen my value proposition.';
  if (/problem/.test(l)) return 'Help me sharpen my problem statement.';
  if (/solution/.test(l)) return 'Help me describe my solution in more depth.';
  if (/runway|burn/.test(l)) return 'Help me work out my runway and burn rate.';
  if (/growth loop|growth/.test(l)) return 'Help me design a growth loop.';
  if (/metric/.test(l)) return 'Help me decide which metrics to track.';
  if (/mvp|ship|launch|\bbuild\b/.test(l)) return 'Help me scope my MVP.';
  if (/capital|fundrais|round|investor/.test(l)) return 'Help me plan my fundraise.';
  if (/users/.test(l)) return 'Help me get my first users.';
  return `Help me with: ${label}`;
}
