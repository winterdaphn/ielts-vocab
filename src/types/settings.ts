export interface Settings {
  provider: 'openai' | 'deepseek' | 'moonshot' | 'zhipu' | 'custom';
  apiKey: string;
  apiBase: string;
  model: string;
  workerUrl: string;
  syncToken: string;
  autoSync: boolean;
  lastSyncAt: number;
  welcomeSeen: boolean;
}

export interface ProviderPreset {
  name: string;
  base: string;
  model: string;
}

export type ProviderKey = Settings['provider'];
