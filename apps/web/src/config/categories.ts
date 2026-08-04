/**
 * 分组方案三：话题桶 + 功能标签（可多选，自由打标）
 */

/** 话题分组（预置，不可删） */
export const TOPIC_CATEGORIES = [
  '01_自然环境',
  '02_科技发展',
  '03_教育学习',
  '04_文化语言',
  '05_娱乐消费',
  '06_健康生活',
  '07_城市交通',
  '08_政治法律',
  '09_社会经济',
  '10_社会人物',
  '11_通用基础',
] as const;

/** 功能标签（预置，不可删） */
export const FUNCTION_CATEGORIES = [
  'F1_行为态度',
  'F2_描述评价',
  'F3_连接过渡',
  'F4_数量时间',
] as const;

export const PRESET_CATEGORIES = [
  ...TOPIC_CATEGORIES,
  ...FUNCTION_CATEGORIES,
] as const;

export type PresetCategory = (typeof PRESET_CATEGORIES)[number];
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];
export type FunctionCategory = (typeof FUNCTION_CATEGORIES)[number];

export const PRESET_CATEGORY_SET = new Set<string>(PRESET_CATEGORIES);
export const TOPIC_CATEGORY_SET = new Set<string>(TOPIC_CATEGORIES);
export const FUNCTION_CATEGORY_SET = new Set<string>(FUNCTION_CATEGORIES);

/** 旧真经 22 类 → 新话题/功能 */
export const LEGACY_CATEGORY_MAP: Record<string, string[]> = {
  '01_自然地理': ['01_自然环境'],
  '02_植物研究': ['01_自然环境'],
  '03_动物保护': ['01_自然环境'],
  '04_太空探索': ['02_科技发展'],
  '05_学校教育': ['03_教育学习'],
  '06_科技发明': ['02_科技发展'],
  '07_文化历史': ['04_文化语言'],
  '08_语言演化': ['04_文化语言'],
  '09_娱乐运动': ['05_娱乐消费'],
  '10_物品材料': ['05_娱乐消费'],
  '11_时尚潮流': ['05_娱乐消费'],
  '12_饮食健康': ['06_健康生活'],
  '13_建筑场所': ['07_城市交通'],
  '14_交通旅行': ['07_城市交通'],
  '15_国家政府': ['08_政治法律'],
  '16_社会经济': ['09_社会经济'],
  '17_法律法规': ['08_政治法律'],
  '18_沙场争锋': ['08_政治法律'],
  '19_社会角色': ['10_社会人物'],
  // 功能向旧类：补通用话题，满足「至少一话题」
  '20_行为动作': ['11_通用基础', 'F1_行为态度'],
  '21_身心健康': ['06_健康生活'],
  '22_时间日期': ['11_通用基础', 'F4_数量时间'],
};

export function isPresetCategory(name: string): boolean {
  return PRESET_CATEGORY_SET.has(name);
}

export function isTopicCategory(name: string): boolean {
  return TOPIC_CATEGORY_SET.has(name);
}

export function isFunctionCategory(name: string): boolean {
  return FUNCTION_CATEGORY_SET.has(name);
}

/** UI 展示名：去掉「01_」「F1_」前缀 */
export function categoryLabel(name: string): string {
  return String(name || '').replace(/^(?:\d+|F\d+)_/, '') || name;
}

/** 旧名 → 新名（单条） */
export function mapLegacyCategory(name: string): string[] {
  if (PRESET_CATEGORY_SET.has(name)) return [name];
  return LEGACY_CATEGORY_MAP[name] || [];
}

/**
 * 迁移并规范化：旧真经类映射到新方案；去重。
 * 话题 / 功能 / 自定义均可多个，不强制数量。
 */
export function migrateCategories(raw: string[]): string[] {
  const expanded: string[] = [];
  for (const c of raw) {
    const mapped = mapLegacyCategory(c);
    if (mapped.length) expanded.push(...mapped);
    else if (c.trim()) expanded.push(c.trim());
  }
  const unique = [...new Set(expanded)];

  const topics: string[] = [];
  const fns: string[] = [];
  const custom: string[] = [];

  for (const c of unique) {
    if (isTopicCategory(c)) topics.push(c);
    else if (isFunctionCategory(c)) fns.push(c);
    else custom.push(c);
  }

  // 预置顺序更稳定，便于筛选展示
  topics.sort(
    (a, b) =>
      TOPIC_CATEGORIES.indexOf(a as TopicCategory) -
      TOPIC_CATEGORIES.indexOf(b as TopicCategory)
  );
  fns.sort(
    (a, b) =>
      FUNCTION_CATEGORIES.indexOf(a as FunctionCategory) -
      FUNCTION_CATEGORIES.indexOf(b as FunctionCategory)
  );

  return [...topics, ...fns, ...custom];
}

/** 兼容旧数据：string / categories[] → string[]（含迁移） */
export function normalizeCategories(raw: unknown, legacyExtra?: unknown): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) {
      for (const x of v) {
        if (typeof x === 'string' && x.trim()) out.push(x.trim());
      }
    }
  };
  push(raw);
  push(legacyExtra);
  return migrateCategories([...new Set(out)]);
}
