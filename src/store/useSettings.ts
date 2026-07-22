/**
 * Settings store — API key, base, model, sync config, etc.
 * Local-only (never synced to cloud).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Settings } from '@/types/settings';
import { DEFAULT_PROVIDER, PROVIDERS } from '@/config/providers';

const initial: Settings = {
  provider: DEFAULT_PROVIDER,
  apiKey: '',
  apiBase: PROVIDERS[DEFAULT_PROVIDER].base,
  model: PROVIDERS[DEFAULT_PROVIDER].model,
  workerUrl: 'https://ielts-vocab-d5gu0dfe9e1a9b5e9-1257115199.ap-shanghai.app.tcloudbase.com/vocab-api',
  syncToken: '',
  autoSync: false,
  lastSyncAt: 0,
  welcomeSeen: false,
};

interface SettingsStore extends Settings {
  update: (patch: Partial<Settings>) => void;
  setProvider: (provider: Settings['provider']) => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...initial,
      update: (patch) => set((s) => ({ ...s, ...patch })),
      setProvider: (provider) =>
        set(() => {
          if (provider === 'custom') {
            return { provider, apiBase: '', model: '' };
          }
          const p = PROVIDERS[provider];
          return { provider, apiBase: p.base, model: p.model };
        }),
    }),
    { name: 'ielts-settings' }
  )
);
