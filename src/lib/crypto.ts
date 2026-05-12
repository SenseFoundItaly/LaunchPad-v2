/**
 * AES-256-GCM encryption for user API keys (BYOK).
 *
 * Uses a server-side ENCRYPTION_KEY env var (32-byte hex or base64).
 * Each encryption produces a random 12-byte IV. The output is a single
 * base64 string: IV (12) + ciphertext + authTag (16).
 *
 * Node's built-in `crypto` module — no external dependencies.
 */

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY env var is required for API key encryption');
  }
  // Accept 64-char hex string (32 bytes) or 44-char base64 (32 bytes).
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length === 32) return buf;
  throw new Error('ENCRYPTION_KEY must be 32 bytes (64-char hex or 44-char base64)');
}

/**
 * Encrypt a plaintext string. Returns a base64 blob containing
 * IV + ciphertext + authTag.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Pack: IV (12) + ciphertext (variable) + authTag (16)
  return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

/**
 * Decrypt a base64 blob produced by `encrypt()`. Returns the original
 * plaintext string, or throws on tamper/wrong key.
 */
export function decrypt(blob: string): string {
  const key = getKey();
  const data = Buffer.from(blob, 'base64');
  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Encrypted blob too short');
  }
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH, data.length - AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * Extract the last 4 characters of a key for display hints (e.g., "...xK7z").
 */
export function keyHint(apiKey: string): string {
  return apiKey.length >= 4 ? `...${apiKey.slice(-4)}` : '****';
}
