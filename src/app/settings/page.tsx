'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import api from '@/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StoredKey {
  id: string;
  provider: string;
  label: string;
  key_hint: string;
  validated_at: string | null;
  created_at: string;
}

interface ModelOption {
  key: string;
  id: string;
  tier: string;
}

interface Preferences {
  preferred_model: string | null;
  available_models: ModelOption[];
}

type Provider = 'anthropic' | 'openai' | 'openrouter';

const PROVIDERS: { value: Provider; label: string; placeholder: string }[] = [
  { value: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
  { value: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
  { value: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-...' },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function SettingsPage() {
  // API Keys state
  const [keys, setKeys] = useState<StoredKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [addingKey, setAddingKey] = useState(false);
  const [newProvider, setNewProvider] = useState<Provider>('anthropic');
  const [newLabel, setNewLabel] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [keySaving, setKeySaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Model preference state
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefsSaving, setPrefsSaving] = useState(false);

  // ─── Fetchers ──────────────────────────────────────────────────────────────

  const fetchKeys = useCallback(async () => {
    try {
      const { data } = await api.get<{ keys: StoredKey[] }>('/api/user/api-keys');
      setKeys(data.keys || []);
    } catch {
      // Not logged in or table doesn't exist yet
    } finally {
      setKeysLoading(false);
    }
  }, []);

  const fetchPrefs = useCallback(async () => {
    try {
      const { data } = await api.get<Preferences>('/api/user/preferences');
      setPrefs(data);
    } catch {
      // Not logged in
    } finally {
      setPrefsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
    fetchPrefs();
  }, [fetchKeys, fetchPrefs]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  async function handleAddKey() {
    setKeyError('');
    if (!newApiKey.trim()) {
      setKeyError('API key is required.');
      return;
    }
    if (!newLabel.trim()) {
      setKeyError('Label is required.');
      return;
    }

    setKeySaving(true);
    try {
      await api.post('/api/user/api-keys', {
        provider: newProvider,
        label: newLabel.trim(),
        api_key: newApiKey.trim(),
      });
      setAddingKey(false);
      setNewApiKey('');
      setNewLabel('');
      setKeyError('');
      await fetchKeys();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save key.';
      setKeyError(msg);
    } finally {
      setKeySaving(false);
    }
  }

  async function handleDeleteKey(keyId: string) {
    setDeletingId(keyId);
    try {
      await api.delete('/api/user/api-keys', { data: { key_id: keyId } });
      await fetchKeys();
    } catch {
      // silently fail — key may already be deleted
    } finally {
      setDeletingId(null);
    }
  }

  async function handleModelChange(modelKey: string | null) {
    setPrefsSaving(true);
    try {
      const { data } = await api.patch<{ preferred_model: string | null }>('/api/user/preferences', {
        preferred_model: modelKey,
      });
      setPrefs((prev) => prev ? { ...prev, preferred_model: data.preferred_model } : prev);
    } catch {
      // silently fail
    } finally {
      setPrefsSaving(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-surface-sunk">
      {/* Header */}
      <header className="h-12 border-b border-line bg-surface-sunk flex items-center px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-moss to-plum flex items-center justify-center">
            <span className="text-white text-xs font-bold">L</span>
          </div>
          <span className="text-white font-semibold tracking-tight text-sm">LaunchPad</span>
        </Link>
        <span className="ml-3 text-ink-6 text-sm">/</span>
        <span className="ml-2 text-ink-4 text-sm">Settings</span>
      </header>

      <div className="max-w-2xl mx-auto py-8 px-6">
        <h1 className="text-xl font-semibold text-white mb-8">Settings</h1>

        {/* ═══ API Keys Section ═══ */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-medium text-white">API Keys</h2>
              <p className="text-xs text-ink-5 mt-0.5">
                Use your own API keys for LLM calls (BYOK). Keys are encrypted at rest.
              </p>
            </div>
            {!addingKey && (
              <button
                onClick={() => setAddingKey(true)}
                className="text-xs px-3 py-1.5 rounded-md bg-moss text-white hover:bg-moss transition-colors"
              >
                Add Key
              </button>
            )}
          </div>

          {/* Stored keys list */}
          {keysLoading ? (
            <div className="text-ink-5 text-sm py-4">Loading...</div>
          ) : keys.length === 0 && !addingKey ? (
            <div className="bg-paper border border-line rounded-xl p-6 text-center">
              <p className="text-sm text-ink-4">No API keys configured.</p>
              <p className="text-xs text-ink-6 mt-1">
                LaunchPad uses system keys by default. Add your own to use your API quota.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {keys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center justify-between bg-paper border border-line rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      k.provider === 'anthropic'
                        ? 'bg-orange-500/20 text-orange-400'
                        : k.provider === 'openai'
                          ? 'bg-moss/20 text-moss'
                          : 'bg-moss/20 text-moss'
                    }`}>
                      {k.provider}
                    </span>
                    <div>
                      <span className="text-sm text-ink-2">{k.label}</span>
                      <span className="ml-2 text-xs text-ink-6 font-mono">{k.key_hint}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {k.validated_at && (
                      <span className="text-[10px] text-emerald-500">Validated</span>
                    )}
                    <button
                      onClick={() => handleDeleteKey(k.id)}
                      disabled={deletingId === k.id}
                      className="text-xs text-clay hover:text-clay disabled:opacity-50 transition-colors"
                    >
                      {deletingId === k.id ? 'Removing...' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add key form */}
          {addingKey && (
            <div className="mt-3 bg-paper border border-line rounded-xl p-4 space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-ink-4 block mb-1">Provider</label>
                  <select
                    value={newProvider}
                    onChange={(e) => setNewProvider(e.target.value as Provider)}
                    className="w-full bg-paper-2 border border-line-2 rounded-md px-3 py-2 text-sm text-ink-2 focus:outline-none focus:ring-1 focus:ring-moss"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-ink-4 block mb-1">Label</label>
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="My Anthropic Key"
                    className="w-full bg-paper-2 border border-line-2 rounded-md px-3 py-2 text-sm text-ink-2 placeholder:text-ink-6 focus:outline-none focus:ring-1 focus:ring-moss"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-ink-4 block mb-1">API Key</label>
                <input
                  type="password"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder={PROVIDERS.find((p) => p.value === newProvider)?.placeholder}
                  className="w-full bg-paper-2 border border-line-2 rounded-md px-3 py-2 text-sm text-ink-2 placeholder:text-ink-6 focus:outline-none focus:ring-1 focus:ring-moss font-mono"
                />
              </div>
              {keyError && (
                <p className="text-xs text-clay">{keyError}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setAddingKey(false); setKeyError(''); setNewApiKey(''); }}
                  className="text-xs px-3 py-1.5 rounded-md text-ink-4 hover:text-ink-3 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddKey}
                  disabled={keySaving}
                  className="text-xs px-3 py-1.5 rounded-md bg-moss text-white hover:bg-moss disabled:opacity-50 transition-colors"
                >
                  {keySaving ? 'Validating...' : 'Save Key'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ═══ Model Preference Section ═══ */}
        <section className="mb-10">
          <h2 className="text-sm font-medium text-white mb-1">Preferred Model</h2>
          <p className="text-xs text-ink-5 mb-4">
            Override the system's automatic model routing. When set, all chat messages use this model.
            Leave on "System Default" for automatic tier-based routing.
          </p>

          {prefsLoading ? (
            <div className="text-ink-5 text-sm py-4">Loading...</div>
          ) : (
            <div className="bg-paper border border-line rounded-xl p-4">
              <div className="space-y-1.5">
                {/* System default option */}
                <label className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-paper-2/50 transition-colors cursor-pointer">
                  <input
                    type="radio"
                    name="model"
                    checked={prefs?.preferred_model === null}
                    onChange={() => handleModelChange(null)}
                    disabled={prefsSaving}
                    className="accent-blue-500"
                  />
                  <div>
                    <span className="text-sm text-ink-2">System Default</span>
                    <span className="ml-2 text-xs text-ink-5">(automatic routing by task complexity)</span>
                  </div>
                </label>

                {/* Available models */}
                {prefs?.available_models.map((m) => (
                  <label
                    key={m.key}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-paper-2/50 transition-colors cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="model"
                      checked={prefs.preferred_model === m.key}
                      onChange={() => handleModelChange(m.key)}
                      disabled={prefsSaving}
                      className="accent-blue-500"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink-2">{m.id}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        m.tier === 'frontier' ? 'bg-plum/20 text-plum'
                        : m.tier === 'balanced' ? 'bg-moss/20 text-moss'
                        : 'bg-ink-5/20 text-ink-4'
                      }`}>
                        {m.tier}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
              {prefsSaving && (
                <p className="text-xs text-ink-5 mt-2">Saving...</p>
              )}
            </div>
          )}
        </section>

        {/* Footer */}
        <div className="border-t border-line pt-4 text-xs text-ink-6">
          API keys are encrypted with AES-256-GCM before storage. The plaintext key is never
          stored or logged. Only the last 4 characters are shown for identification.
        </div>
      </div>
    </div>
  );
}
