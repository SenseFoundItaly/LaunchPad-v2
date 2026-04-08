import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.LAUNCHPAD_DB_PATH || path.join(process.cwd(), 'data', 'launchpad.db');
const SCHEMA_PATH = path.join(process.cwd(), 'db', 'schema.sql');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {fs.mkdirSync(dir, { recursive: true });}
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    // Initialize schema
    if (fs.existsSync(SCHEMA_PATH)) {
      const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
      // Split on semicolons and execute each statement
      const statements = schema.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const stmt of statements) {
        try {
          db.exec(stmt);
        } catch {
          // Skip DuckDB-specific syntax that doesn't work in SQLite
        }
      }
    }
  }
  return db;
}

export function query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  const d = getDb();
  return d.prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: unknown[]) {
  const d = getDb();
  return d.prepare(sql).run(...params);
}

export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  const d = getDb();
  return d.prepare(sql).get(...params) as T | undefined;
}
