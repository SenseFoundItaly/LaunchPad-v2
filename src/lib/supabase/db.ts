import { createServerSupabase } from './server';

/**
 * Supabase query helper — drop-in-ish replacement for SQLite query().
 * All queries are automatically scoped by RLS (user must be authenticated).
 */
export async function supaQuery<T = Record<string, unknown>>(
  table: string,
  options?: {
    select?: string;
    eq?: Record<string, unknown>;
    order?: { column: string; ascending?: boolean };
    limit?: number;
    single?: boolean;
  }
): Promise<T[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from(table).select(options?.select || '*');

  if (options?.eq) {
    for (const [col, val] of Object.entries(options.eq)) {
      q = q.eq(col, val);
    }
  }

  if (options?.order) {
    q = q.order(options.order.column, { ascending: options.order.ascending ?? false });
  }

  if (options?.limit) {
    q = q.limit(options.limit);
  }

  if (options?.single) {
    const { data, error } = await q.single();
    if (error) return [];
    return [data as T];
  }

  const { data, error } = await q;
  if (error) { console.error('Supabase query error:', error.message); return []; }
  return (data || []) as T[];
}

export async function supaInsert<T = Record<string, unknown>>(
  table: string,
  row: Record<string, unknown>,
): Promise<T | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) { console.error('Supabase insert error:', error.message); return null; }
  return data as T;
}

export async function supaUpsert<T = Record<string, unknown>>(
  table: string,
  row: Record<string, unknown>,
  onConflict?: string,
): Promise<T | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from(table)
    .upsert(row, { onConflict })
    .select()
    .single();
  if (error) { console.error('Supabase upsert error:', error.message); return null; }
  return data as T;
}

export async function supaUpdate(
  table: string,
  updates: Record<string, unknown>,
  eq: Record<string, unknown>,
): Promise<boolean> {
  const supabase = await createServerSupabase();
  let q = supabase.from(table).update(updates);
  for (const [col, val] of Object.entries(eq)) {
    q = q.eq(col, val);
  }
  const { error } = await q;
  if (error) { console.error('Supabase update error:', error.message); return false; }
  return true;
}

export async function supaDelete(
  table: string,
  eq: Record<string, unknown>,
): Promise<boolean> {
  const supabase = await createServerSupabase();
  let q = supabase.from(table).delete();
  for (const [col, val] of Object.entries(eq)) {
    q = q.eq(col, val);
  }
  const { error } = await q;
  if (error) { console.error('Supabase delete error:', error.message); return false; }
  return true;
}
