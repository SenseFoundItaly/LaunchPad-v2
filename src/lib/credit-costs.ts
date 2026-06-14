/**
 * Credit cost constants — client-safe (NO db / server imports), so client
 * components can display costs without bundling server code. `@/lib/credits`
 * re-exports these and owns the actual debit logic.
 */

/**
 * Flat credit cost to APPLY a knowledge proposal (insight / entity /
 * comparison / metric / fact) into project intelligence. Charged once, on the
 * pending→applied transition — never on re-apply or on dismiss. Founder
 * directive 2026-06-11: surfacing knowledge is free; APPLYING it costs 2.
 */
export const KNOWLEDGE_APPLY_CREDITS = 2;

/**
 * Flat credit cost to AUDIT one uploaded document — run the extraction passes
 * (entities / canvas / monitors) and ingest it. Founder decision 2026-06-14:
 * documents are priced per-document at a flat rate (complexity-independent);
 * applying the entities the audit surfaces is then FREE (you already paid to
 * audit the doc). Charged once per ingested document in the knowledge upload
 * route when ?audit_charge=1 is set.
 */
export const DOCUMENT_AUDIT_CREDITS = 3;
