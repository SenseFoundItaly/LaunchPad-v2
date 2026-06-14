import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { get, run } from '@/lib/db';
import { MODEL_CONFIG } from '@/lib/llm/models';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, SUPPORTED_LOCALES } from '@/lib/i18n/locales';

const VALID_MODEL_KEYS = new Set(Object.keys(MODEL_CONFIG));

// One year — the locale is durable in users.locale; this cookie is just the
// fast synchronous read path for the server layout. `lax` so it survives normal
// navigation; not httpOnly so the (future) client could read it if ever needed.
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * GET /api/user/preferences — get user preferences (preferred model, locale).
 */
export async function GET() {
  try {
    const { userId } = await requireUser();
    const user = await get<{ preferred_model: string | null; locale: string | null }>(
      'SELECT preferred_model, locale FROM users WHERE id = ?',
      userId,
    );
    return NextResponse.json({
      preferred_model: user?.preferred_model ?? null,
      locale: isLocale(user?.locale) ? user!.locale : DEFAULT_LOCALE,
      available_locales: SUPPORTED_LOCALES,
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
 * Body: { preferred_model?: string | null; locale?: string }
 *
 * Each field is only written when PRESENT in the body, so a locale-only request
 * doesn't clobber preferred_model (and vice-versa).
 */
export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireUser();
    const body = (await req.json()) as { preferred_model?: string | null; locale?: string };

    if ('preferred_model' in body) {
      const { preferred_model } = body;
      if (
        preferred_model !== null &&
        preferred_model !== undefined &&
        !VALID_MODEL_KEYS.has(preferred_model)
      ) {
        return NextResponse.json(
          { error: `Invalid model. Must be one of: ${[...VALID_MODEL_KEYS].join(', ')} or null for system default.` },
          { status: 400 },
        );
      }
      await run('UPDATE users SET preferred_model = ? WHERE id = ?', preferred_model ?? null, userId);
    }

    let nextLocale: string | undefined;
    if ('locale' in body) {
      if (!isLocale(body.locale)) {
        return NextResponse.json(
          { error: `Invalid locale. Must be one of: ${SUPPORTED_LOCALES.join(', ')}.` },
          { status: 400 },
        );
      }
      await run('UPDATE users SET locale = ? WHERE id = ?', body.locale, userId);
      nextLocale = body.locale;
    }

    const updated = await get<{ preferred_model: string | null; locale: string | null }>(
      'SELECT preferred_model, locale FROM users WHERE id = ?',
      userId,
    );
    const res = NextResponse.json({
      preferred_model: updated?.preferred_model ?? null,
      locale: isLocale(updated?.locale) ? updated!.locale : DEFAULT_LOCALE,
    });

    // Mirror the new locale into the cookie so the next server render (after the
    // client reloads) picks it up without a DB round-trip.
    if (nextLocale) {
      res.cookies.set(LOCALE_COOKIE, nextLocale, {
        path: '/',
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: 'lax',
      });
    }

    return res;
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
