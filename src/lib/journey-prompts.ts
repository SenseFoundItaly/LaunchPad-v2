/**
 * Map an open validation check's label to an actionable co-pilot prompt.
 * Keyword-matched (robust to check-id / label changes). Shared by the chat
 * empty-state briefing, the project-brief endpoint, and the clickable
 * SpineSection substeps — so "click an unmet substep → pre-fill chat" and the
 * briefing's next steps always phrase the ask the same way.
 *
 * Pure → depends only on the injected translate fn, so it's safe in both client
 * components (pass `useT()`) and server routes (pass `(k, v) => translate(locale, k, v)`).
 * The returned prompt is localized to the caller's locale; the keyword match runs
 * on the (always-English) check label, so category routing is locale-independent.
 */
import type { MessageKey, TranslateVars } from '@/lib/i18n/messages';

type TFn = (key: MessageKey, vars?: TranslateVars) => string;

export function checkActionPrompt(label: string, t: TFn): string {
  const l = label.toLowerCase();
  // `/dependenc/` before feasibility: "Key technical dependencies named" matches both.
  if (/dependenc/.test(l)) return t('journey-prompt.dependencies');
  if (/feasibilit|technical/.test(l)) return t('journey-prompt.feasibility');
  if (/regulat|complian|gdpr|licens/.test(l)) return t('journey-prompt.regulatory');
  if (/segment|icp|ideal customer|persona|beachhead/.test(l)) return t('journey-prompt.segment');
  if (/competitor/.test(l)) return t('journey-prompt.competitors');
  if (/interview/.test(l)) return t('journey-prompt.interviews');
  if (/watcher|monitor/.test(l)) return t('journey-prompt.watcher');
  if (/market size|\btam\b|\bsam\b|\bsom\b/.test(l)) return t('journey-prompt.market-size');
  if (/pain/.test(l)) return t('journey-prompt.pain-point');
  if (/channel|acquisition|reach|distribution/.test(l)) return t('journey-prompt.channels');
  if (/business model|revenue|pricing|unit econ|tier|willingness|anchor price/.test(l)) return t('journey-prompt.business-model');
  if (/differentiat|competitive|edge|advantage/.test(l)) return t('journey-prompt.differentiation');
  if (/value prop/.test(l)) return t('journey-prompt.value-prop');
  if (/problem/.test(l)) return t('journey-prompt.problem');
  if (/solution/.test(l)) return t('journey-prompt.solution');
  if (/runway|burn/.test(l)) return t('journey-prompt.runway');
  if (/growth loop|growth/.test(l)) return t('journey-prompt.growth');
  if (/metric/.test(l)) return t('journey-prompt.metrics');
  if (/mvp|ship|launch|\bbuild\b/.test(l)) return t('journey-prompt.mvp');
  if (/capital|fundrais|round|investor/.test(l)) return t('journey-prompt.fundraise');
  if (/users/.test(l)) return t('journey-prompt.users');
  return t('journey-prompt.generic', { label });
}
