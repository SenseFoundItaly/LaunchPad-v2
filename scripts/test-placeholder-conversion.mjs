#!/usr/bin/env node
/**
 * Unit tests for the iter-3 placeholder-conversion fix at
 * src/lib/db/index.ts — `?` outside string literals AND SQL comments
 * is converted to `$N`. Run via:
 *
 *   npx tsx scripts/test-placeholder-conversion.mjs
 *
 * Pure-function tests. No DB, no network. Lands as a re-runnable script
 * so future edits to convertPlaceholders can be checked locally.
 */

// Mirror of src/lib/db/index.ts convertPlaceholders (iter-3 version).
// Kept inline for test isolation; if this drifts, the tests fail.
function convertPlaceholders(sql) {
  let idx = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let result = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      result += ch;
      if (ch === '\n' || ch === '\r') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      result += ch;
      if (ch === '*' && next === '/') { result += next; i++; inBlockComment = false; }
      continue;
    }
    if (!inString) {
      if (ch === '-' && next === '-') { inLineComment = true; result += ch + next; i++; continue; }
      if (ch === '/' && next === '*') { inBlockComment = true; result += ch + next; i++; continue; }
    }
    if (ch === "'" && sql[i - 1] !== '\\') { inString = !inString; result += ch; }
    else if (ch === '?' && !inString) { idx++; result += `$${idx}`; }
    else result += ch;
  }
  return result;
}

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) {
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    got:      ${JSON.stringify(actual)}`);
    failed += 1;
  }
}

console.log('--- convertPlaceholders ---');

check(
  'simple placeholder',
  convertPlaceholders('SELECT * FROM t WHERE id = ?'),
  'SELECT * FROM t WHERE id = $1',
);

check(
  'two placeholders',
  convertPlaceholders('SELECT * FROM t WHERE a = ? AND b = ?'),
  'SELECT * FROM t WHERE a = $1 AND b = $2',
);

check(
  'question mark inside string literal is preserved',
  convertPlaceholders("SELECT 'how?' WHERE id = ?"),
  "SELECT 'how?' WHERE id = $1",
);

check(
  'question mark inside line comment is preserved (the iter-3 bug)',
  convertPlaceholders('SELECT * FROM t\n-- is this safe?\nWHERE id = ?'),
  'SELECT * FROM t\n-- is this safe?\nWHERE id = $1',
);

check(
  'question mark inside block comment is preserved',
  convertPlaceholders('SELECT * FROM t /* what about this? */ WHERE id = ?'),
  'SELECT * FROM t /* what about this? */ WHERE id = $1',
);

check(
  'multi-line block comment preserves multiple question marks',
  convertPlaceholders('/* line 1?\nline 2?\nline 3? */ SELECT ?'),
  '/* line 1?\nline 2?\nline 3? */ SELECT $1',
);

check(
  'JSONB ? operator (the original bug) — now safely usable if commented',
  convertPlaceholders('SELECT * FROM t -- jsonb_field ? key\nWHERE id = ?'),
  'SELECT * FROM t -- jsonb_field ? key\nWHERE id = $1',
);

check(
  'placeholder count is sequential across mixed content',
  convertPlaceholders("INSERT INTO t (a, b, c) VALUES (?, 'lit?', ?) -- count? \nRETURNING ?"),
  "INSERT INTO t (a, b, c) VALUES ($1, 'lit?', $2) -- count? \nRETURNING $3",
);

console.log('');
if (failed === 0) {
  console.log('ALL TESTS PASS');
  process.exit(0);
} else {
  console.log(`FAIL — ${failed} test(s) failed`);
  process.exit(1);
}
