import type { ProviderKey, ProviderPreset } from '@/types/settings';

export const PROVIDERS: Record<ProviderKey, ProviderPreset> = {
  openai: {
    name: 'OpenAI',
    base: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  deepseek: {
    name: 'DeepSeek',
    base: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  moonshot: {
    name: 'Moonshot',
    base: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
  zhipu: {
    name: '智谱 GLM',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  custom: {
    name: '自定义',
    base: '',
    model: '',
  },
};

export const DEFAULT_PROVIDER: ProviderKey = 'deepseek';
