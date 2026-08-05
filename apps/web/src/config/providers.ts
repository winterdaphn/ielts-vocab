import type { ProviderKey, ProviderPreset } from '@/types/settings';

export const PROVIDERS: Record<ProviderKey, ProviderPreset> = {
  openai: {
    name: 'OpenAI',
    base: 'https://api.openai.com/v1',
    modelLow: 'gpt-4o-mini',
    modelMid: 'gpt-4o-mini',
    modelHigh: 'gpt-4o',
    model: 'gpt-4o-mini',
  },
  deepseek: {
    name: 'DeepSeek',
    base: 'https://api.deepseek.com/v1',
    modelLow: 'deepseek-chat',
    modelMid: 'deepseek-chat',
    modelHigh: 'deepseek-reasoner',
    model: 'deepseek-chat',
  },
  moonshot: {
    name: 'Moonshot',
    base: 'https://api.moonshot.cn/v1',
    modelLow: 'moonshot-v1-8k',
    modelMid: 'moonshot-v1-32k',
    modelHigh: 'moonshot-v1-128k',
    model: 'moonshot-v1-32k',
  },
  zhipu: {
    name: '智谱 GLM',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    modelLow: 'glm-4-flash',
    modelMid: 'glm-4-air',
    modelHigh: 'glm-4-plus',
    model: 'glm-4-air',
  },
  custom: {
    name: '自定义',
    base: '',
    modelLow: '',
    modelMid: '',
    modelHigh: '',
    model: '',
  },
};

export const DEFAULT_PROVIDER: ProviderKey = 'deepseek';
