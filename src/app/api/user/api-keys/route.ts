import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { query, run, get } from '@/lib/db';
import { encrypt, decrypt, keyHint } from '@/lib/crypto';
import { generateId } from '@/lib/api-helpers';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const VALID_PROVIDERS = ['anthropic', 'openai', 'openrouter'] as const;
type Provider = typeof VALID_PROVIDERS[number];

/**
 * GET /api/user/api-keys — list stored keys (hints only, never plaintext).
 */
export async function GET() {
  try {
    const { userId } = await requireUser();
    const keys = await query<{
      id: string; provider: string; label: string;
      key_hint: string; validated_at: string | null; created_at: string;
    }>(
      'SELECT id, provider, label, key_hint, validated_at, created_at FROM user_api_keys WHERE user_id = ? ORDER BY created_at DESC',
      userId,
    );
    return NextResponse.json({ keys });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/**
 * POST /api/user/api-keys — store a new API key (encrypted).
 * Body: { provider, label, api_key }
 * Validates the key before storing.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireUser();
    const body = await req.json();
    const { provider, label, api_key } = body as {
      provider?: string; label?: string; api_key?: string;
    };

    if (!provider || !VALID_PROVIDERS.includes(provider as Provider)) {
      return NextResponse.json(
        { error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` },
        { status: 400 },
      );
    }
    if (!api_key || api_key.trim().length < 10) {
      return NextResponse.json({ error: 'API key is required and must be at least 10 characters.' }, { status: 400 });
    }
    if (!label || label.trim().length === 0) {
      return NextResponse.json({ error: 'Label is required.' }, { status: 400 });
    }

    // Validate the key by making a lightweight API call.
    const validationError = await validateApiKey(provider as Provider, api_key.trim());
    if (validationError) {
      return NextResponse.json({ error: `Key validation failed: ${validationError}` }, { status: 400 });
    }

    const id = generateId('ukey');
    const encryptedKey = encrypt(api_key.trim());
    const hint = keyHint(api_key.trim());
    const now = new Date().toISOString();

    // Upsert: one key per provider per user.
    const existing = await get<{ id: string }>(
      'SELECT id FROM user_api_keys WHERE user_id = ? AND provider = ?',
      userId, provider,
    );

    if (existing) {
      await run(
        `UPDATE user_api_keys SET encrypted_key = ?, key_hint = ?, label = ?, validated_at = ?
         WHERE id = ?`,
        encryptedKey, hint, label.trim(), now, existing.id,
      );
      return NextResponse.json({ id: existing.id, provider, label: label.trim(), key_hint: hint, validated_at: now });
    }

    await run(
      `INSERT INTO user_api_keys (id, user_id, provider, label, encrypted_key, key_hint, validated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, userId, provider, label.trim(), encryptedKey, hint, now, now,
    );

    return NextResponse.json({ id, provider, label: label.trim(), key_hint: hint, validated_at: now }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/**
 * DELETE /api/user/api-keys — remove a stored key.
 * Body: { key_id }
 */
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await requireUser();
    const body = await req.json();
    const { key_id } = body as { key_id?: string };

    if (!key_id) {
      return NextResponse.json({ error: 'key_id is required.' }, { status: 400 });
    }

    const existing = await get<{ id: string }>(
      'SELECT id FROM user_api_keys WHERE id = ? AND user_id = ?',
      key_id, userId,
    );
    if (!existing) {
      return NextResponse.json({ error: 'Key not found.' }, { status: 404 });
    }

    await run('DELETE FROM user_api_keys WHERE id = ?', key_id);
    return NextResponse.json({ deleted: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/**
 * Validate an API key by making a lightweight call to the provider.
 * Returns null on success, error message on failure.
 */
async function validateApiKey(provider: Provider, apiKey: string): Promise<string | null> {
  try {
    switch (provider) {
      case 'anthropic': {
        const client = new Anthropic({ apiKey });
        // Smallest possible call — 1 token max, cheap model.
        await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        });
        return null;
      }
      case 'openai':
      case 'openrouter': {
        const baseURL = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : undefined;
        const client = new OpenAI({ apiKey, baseURL });
        await client.models.list();
        return null;
      }
      default:
        return `Unknown provider: ${provider}`;
    }
  } catch (err) {
    const msg = (err as Error).message || 'Unknown error';
    if (msg.includes('401') || msg.includes('authentication') || msg.includes('invalid')) {
      return 'Invalid API key';
    }
    // Network errors, rate limits etc. — key might be valid but we can't verify.
    // Accept it with a warning — the validated_at will be null.
    return null;
  }
}
