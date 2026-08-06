import type {
  RelatedWord,
  StoredSynonymDiff,
  SynonymDiffItem,
  SynonymDiffResult,
} from '@/types/word';

/** 辨析缓存键：中心词 + 近义词列表（不含句子） */
export function synonymDiffBaseKey(
  head: string,
  syns: RelatedWord[]
): string {
  const peers = syns
    .map((s) => String(s.word || '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
  return `${head.trim().toLowerCase()}|${peers}`;
}

function normalizeSentenceSnippet(sentence: string): string {
  return String(sentence || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

/** 本句替换判断的会话键（不上云、不写 Word） */
export function synonymDiffReplaceKey(
  head: string,
  syns: RelatedWord[],
  sentence: string
): string {
  const base = synonymDiffBaseKey(head, syns);
  const sent = normalizeSentenceSnippet(sentence);
  return sent ? `${base}|${sent}` : base;
}

/** 旧版 key 含第三段句子；新版仅存 baseKey */
export function storedSynonymDiffMatchesBase(
  stored: StoredSynonymDiff | null | undefined,
  baseKey: string
): boolean {
  if (!stored?.key) return false;
  return stored.key === baseKey || stored.key.startsWith(`${baseKey}|`);
}

export function stripReplaceFields(
  items: SynonymDiffItem[]
): SynonymDiffItem[] {
  return items.map(({ word, focus, usage }) => ({ word, focus, usage }));
}

/** 写入 Word / 上传云端用的辨析（无本句替换字段、无 sentence） */
export function toPersistedSynonymDiff(
  baseKey: string,
  result: Pick<SynonymDiffResult, 'summary' | 'items'>
): StoredSynonymDiff {
  return {
    key: baseKey,
    summary: result.summary,
    items: stripReplaceFields(result.items),
    contrasts: [],
  };
}

export function baseResultFromStored(
  stored: StoredSynonymDiff
): SynonymDiffResult {
  return {
    summary: stored.summary || '',
    items: stripReplaceFields(Array.isArray(stored.items) ? stored.items : []),
    contrasts: [],
  };
}

export function mergeReplaceIntoBase(
  base: SynonymDiffResult,
  sentence: string,
  replaceItems: Pick<
    SynonymDiffItem,
    'word' | 'replaceOk' | 'replaceNote'
  >[]
): SynonymDiffResult {
  const byWord = new Map(
    replaceItems.map((r) => [r.word.toLowerCase(), r])
  );
  const items = base.items.map((it) => {
    const r = byWord.get(it.word.toLowerCase());
    if (!r || typeof r.replaceOk !== 'boolean') return it;
    return {
      ...it,
      replaceOk: r.replaceOk,
      replaceNote: r.replaceNote,
    };
  });
  return {
    ...base,
    items,
    sentence: sentence.trim().slice(0, 280),
  };
}
