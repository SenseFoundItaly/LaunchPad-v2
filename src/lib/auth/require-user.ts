import crypto from 'crypto';
import { get, run } from '@/lib/db';
import { getSupabaseServer } from './supabase-server';

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export type SessionUser = {
  userId: string;
  email: string;
  orgId: string;
};

/**
 * Resolves the current user from the Supabase session cookie, upserts a
 * shadow row in our SQLite `users` table, ensures a personal organization
 * with an owner membership exists, and returns { userId, email, orgId }.
 *
 * Throws AuthError(401) if there is no session. Callers in API routes
 * should catch and return a 401 response; middleware already redirects
 * unauthenticated page requests to /login.
 *
 * Idempotent: SELECTs first, only INSERTs when missing.
 */
export async function requireUser(): Promise<SessionUser> {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    throw new AuthError(401, 'Not authenticated');
  }

  const userId = user.id;
  const email = user.email;

  // Upsert shadow user
  const existing = await get<{ id: string }>('SELECT id FROM users WHERE id = ?', userId);
  if (!existing) {
    await run('INSERT INTO users (id, email) VALUES (?, ?)', userId, email);
  }

  // Find the user's personal (owner) org, or create one.
  const membership = await get<{ org_id: string }>(
    `SELECT m.org_id FROM memberships m WHERE m.user_id = ? AND m.role = 'owner' LIMIT 1`,
    userId,
  );

  let orgId: string;
  if (membership) {
    orgId = membership.org_id;
  } else {
    orgId = crypto.randomUUID();
    const slug = email
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    await run(
      'INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)',
      orgId,
      `${email}'s workspace`,
      slug,
    );
    await run(
      'INSERT INTO memberships (id, user_id, org_id, role) VALUES (?, ?, ?, ?)',
      crypto.randomUUID(),
      userId,
      orgId,
      'owner',
    );
  }

  return { userId, email, orgId };
}

/**
 * Like requireUser() but returns null instead of throwing.
 * Useful for routes that have both authed and public behaviors.
 */
export async function getOptionalUser(): Promise<SessionUser | null> {
  try {
    return await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return null;
    throw e;
  }
}
