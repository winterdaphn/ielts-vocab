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
  // Dev: leave empty and use Vite proxy, or set http://127.0.0.1:3000
  // Prod: e.g. http://129.204.147.93  (nginx serves /api)
  workerUrl: '',
  syncToken: '',
  autoSync: true,
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
