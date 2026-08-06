/**
 * Settings store — API key, base, model, sync config, etc.
 * Local-only (never synced to cloud).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Settings } from '@/types/settings';
import { DEFAULT_PROVIDER, PROVIDERS } from '@/config/providers';

const p0 = PROVIDERS[DEFAULT_PROVIDER];

const initial: Settings = {
  provider: DEFAULT_PROVIDER,
  apiKey: '',
  apiBase: p0.base,
  model: p0.modelMid,
  modelLow: p0.modelLow,
  modelMid: p0.modelMid,
  modelHigh: p0.modelHigh,
  workerUrl: '',
  syncToken: '',
  autoSync: true,
  lastSyncAt: 0,
  lastSrsSyncAt: 0,
  lastChunkSyncAt: 0,
  lastFrameSyncAt: 0,
  welcomeSeen: false,
};

function providerModels(provider: Settings['provider']) {
  if (provider === 'custom') {
    return { model: '', modelLow: '', modelMid: '', modelHigh: '' };
  }
  const p = PROVIDERS[provider];
  return {
    model: p.modelMid,
    modelLow: p.modelLow,
    modelMid: p.modelMid,
    modelHigh: p.modelHigh,
  };
}

interface SettingsStore extends Settings {
  update: (patch: Partial<Settings>) => void;
  setProvider: (provider: Settings['provider']) => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...initial,
      update: (patch) =>
        set((s) => {
          const next = { ...s, ...patch };
          if (
            patch.modelMid !== undefined ||
            patch.modelLow !== undefined ||
            patch.modelHigh !== undefined
          ) {
            next.model = next.modelMid || next.model;
          } else if (patch.model !== undefined && !patch.modelMid) {
            next.modelMid = patch.model;
          }
          return next;
        }),
      setProvider: (provider) =>
        set(() => ({
          provider,
          apiBase: provider === 'custom' ? '' : PROVIDERS[provider].base,
          ...providerModels(provider),
        })),
    }),
    {
      name: 'ielts-settings',
      version: 1,
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<Settings>;
        const provider = s.provider ?? DEFAULT_PROVIDER;
        const preset = PROVIDERS[provider as Settings['provider']] ?? p0;
        const mid = s.modelMid || s.model || preset.modelMid;
        if (version < 1) {
          return {
            ...initial,
            ...s,
            modelMid: mid,
            modelLow: s.modelLow || mid,
            modelHigh: s.modelHigh || mid,
            model: mid,
          };
        }
        return { ...initial, ...s } as Settings;
      },
    }
  )
);
