import postgres from 'postgres';

// ---------------------------------------------------------------------------
// Singleton — survives Next.js HMR (dev-mode hot reloads create new module
// instances; storing on globalThis prevents leaked connections).
// ---------------------------------------------------------------------------
const globalForPg = globalThis as unknown as { __pg?: postgres.Sql };

function getSql(): postgres.Sql {
  if (!globalForPg.__pg) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        'DATABASE_URL is not set. Add it to .env.local (or your deploy platform env vars).'
      );
    }
    globalForPg.__pg = postgres(url, {
      // Supabase PgBouncer (transaction mode) doesn't support prepared stmts
      prepare: false,
      // Idle timeout — close unused connections after 20s in serverless
      idle_timeout: 20,
      // Max connections — keep low for serverless (each function invocation
      // gets its own pool; Supabase pooler handles the real fan-out)
      max: 3,
    });
  }
  return globalForPg.__pg;
}

// ---------------------------------------------------------------------------
// Placeholder conversion: `?` → `$1, $2, ...`
// Skips `?` characters inside single-quoted string literals AND inside SQL
// line comments (`-- ... \n`) and block comments (`/* ... */`). The comment
// skips were added in iter-3 QA after a real bug: explanatory `?` in a SQL
// `--` comment got eaten as a placeholder, throwing the binding count off
// and producing "syntax error at or near $1". See timeline route fix
// commit 90e3ba7 for the field report.
// ---------------------------------------------------------------------------
function convertPlaceholders(sql: string): string {
  let idx = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let result = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Exit a line comment when a newline appears (skip the actual newline check
    // after passing it through unchanged).
    if (inLineComment) {
      result += ch;
      if (ch === '\n' || ch === '\r') inLineComment = false;
      continue;
    }
    // Exit a block comment on `*/`.
    if (inBlockComment) {
      result += ch;
      if (ch === '*' && next === '/') {
        result += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    // Detect comment starts only when not already inside a string. SQL line
    // comment is `--`; block comment is `/* ... */`.
    if (!inString) {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        result += ch + next;
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        result += ch + next;
        i++;
        continue;
      }
    }

    if (ch === "'" && sql[i - 1] !== '\\') {
      inString = !inString;
      result += ch;
    } else if (ch === '?' && !inString) {
      idx++;
      result += `$${idx}`;
    } else {
      result += ch;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API — matches the old synchronous signatures but now returns Promises.
// All existing callers just need to `await` these calls.
// ---------------------------------------------------------------------------

/**
 * Run a SELECT query, returns array of rows.
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const pg = getSql();
  const converted = convertPlaceholders(sql);
  const rows = await pg.unsafe(converted, params as never[]);
  return rows as unknown as T[];
}

/**
 * Run a mutating statement (INSERT/UPDATE/DELETE). Returns the result rows
 * (useful for RETURNING clauses) or empty array.
 */
export async function run(
  sql: string,
  ...params: unknown[]
): Promise<postgres.RowList<postgres.Row[]>> {
  const pg = getSql();
  const converted = convertPlaceholders(sql);
  return pg.unsafe(converted, params as never[]);
}

/**
 * Run a query expecting a single row (or undefined). Sugar for
 * `(await query(...))[0]`.
 */
export async function get<T = Record<string, unknown>>(
  sql: string,
  ...params: unknown[]
): Promise<T | undefined> {
  const rows = await query<T>(sql, ...params);
  return rows[0];
}
