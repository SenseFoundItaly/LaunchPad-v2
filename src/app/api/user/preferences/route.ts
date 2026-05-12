import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { get, run } from '@/lib/db';
import { MODEL_CONFIG } from '@/lib/llm/models';

const VALID_MODEL_KEYS = new Set(Object.keys(MODEL_CONFIG));

/**
 * GET /api/user/preferences — get user preferences (preferred model, etc.).
 */
export async function GET() {
  try {
    const { userId } = await requireUser();
    const user = await get<{ preferred_model: string | null }>(
      'SELECT preferred_model FROM users WHERE id = ?',
      userId,
    );
    return NextResponse.json({
      preferred_model: user?.preferred_model ?? null,
      available_models: Object.entries(MODEL_CONFIG).map(([key, cfg]) => ({
        key,
        id: cfg.id,
        tier: cfg.tier,
      })),
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/**
 * PATCH /api/user/preferences — update preferences.
 * Body: { preferred_model?: string | null }
 */
export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireUser();
    const body = await req.json();
    const { preferred_model } = body as { preferred_model?: string | null };

    if (preferred_model !== null && preferred_model !== undefined) {
      if (!VALID_MODEL_KEYS.has(preferred_model)) {
        return NextResponse.json(
          { error: `Invalid model. Must be one of: ${[...VALID_MODEL_KEYS].join(', ')} or null for system default.` },
          { status: 400 },
        );
      }
    }

    await run(
      'UPDATE users SET preferred_model = ? WHERE id = ?',
      preferred_model ?? null, userId,
    );

    return NextResponse.json({ preferred_model: preferred_model ?? null });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
