/** low=轻量快；mid=练习出题/判分；high=例句/近义辨析等重质量 */
export type ModelTier = 'low' | 'mid' | 'high';

export interface Settings {
  provider: 'openai' | 'deepseek' | 'moonshot' | 'zhipu' | 'custom';
  apiKey: string;
  apiBase: string;
  /** @deprecated 同步兼容；等于 modelMid */
  model: string;
  modelLow: string;
  modelMid: string;
  modelHigh: string;
  workerUrl: string;
  syncToken: string;
  autoSync: boolean;
  lastSyncAt: number;
  welcomeSeen: boolean;
}

export interface ProviderPreset {
  name: string;
  base: string;
  /** 默认中档，与 modelMid 一致 */
  model: string;
  modelLow: string;
  modelMid: string;
  modelHigh: string;
}

export type ProviderKey = Settings['provider'];
