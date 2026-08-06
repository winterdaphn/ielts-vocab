/**
 * Relational words / prefs API client (JWT Bearer).
 */
import type { Settings } from '@/types/settings';
import type { Word } from '@/types/word';
import { toPersistedSynonymDiff } from '@/utils/synonymDiffStorage';
import type { StoredSynonymDiff } from '@/types/word';
import { SRS_FIELD_KEYS } from '@/types/srsProgress';
import { applySrsToWord, patchSrsFields, putSrs, SrsApiError } from '@/api/srsApi';

export class WordsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getBase(settings: Settings): string {
  return (settings.workerUrl || '').replace(/\/$/, '');
}

function authHeaders(settings: Settings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.syncToken) h.Authorization = `Bearer ${settings.syncToken}`;
  return h;
}

async function readJson(resp: Response): Promise<Record<string, unknown>> {
  try {
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 上传云端：仅 summary/items，不含本句 replace */
function synonymDiffForApi(w: Word): Record<string, unknown> | undefined {
  const sd = w.synonymDiff;
  if (!sd?.key || (!sd.summary && !sd.items?.length)) return undefined;
  return toPersistedSynonymDiff(sd.key, sd) as unknown as Record<string, unknown>;
}

/** Strip local-only fields before upload */
export function wordToApiBody(w: Word): Record<string, unknown> {
  const synonymDiff = synonymDiffForApi(w);
  return {
    id: w.id,
    word: w.word,
    translation: w.translation || '',
    phoneticUs: w.phoneticUs || '',
    phoneticUk: w.phoneticUk || '',
    partOfSpeech: w.partOfSpeech || '',
    mnemonic: w.mnemonic || '',
    category: w.category || [],
    synonyms: w.synonyms || [],
    similars: w.similars || [],
    derivatives: w.derivatives || [],
    collocations: w.collocations || [],
    dictCollocations: w.dictCollocations || [],
    examples: w.examples || [],
    crossedOut: !!w.crossedOut,
    starred: !!w.starred,
    ease: w.ease ?? 2.5,
    interval: w.interval ?? 0,
    streak: w.streak ?? 0,
    nextReview: w.nextReview ?? Date.now(),
    totalReviews: w.totalReviews ?? 0,
    correctReviews: w.correctReviews ?? 0,
    createdAt: w.createdAt ?? Date.now(),
    updatedAt: (w as Word & { updatedAt?: number }).updatedAt ?? Date.now(),
    ...(synonymDiff ? { synonymDiff } : {}),
  };
}

function parseWord(raw: unknown): Word | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '').trim();
  const word = String(o.word || id).trim();
  if (!id && !word) return null;
  const rawSd = o.synonymDiff ?? o.synonym_diff;
  let synonymDiff: StoredSynonymDiff | undefined;
  if (rawSd && typeof rawSd === 'object') {
    const sd = rawSd as Record<string, unknown>;
    const key = String(sd.key || '').trim();
    if (key) {
      synonymDiff = toPersistedSynonymDiff(key, {
        summary: String(sd.summary || ''),
        items: Array.isArray(sd.items) ? (sd.items as StoredSynonymDiff['items']) : [],
      });
    }
  }
  return {
    id: id || word.toLowerCase(),
    word,
    translation: String(o.translation || ''),
    phoneticUs: String(o.phoneticUs || ''),
    phoneticUk: String(o.phoneticUk || ''),
    partOfSpeech: String(o.partOfSpeech || ''),
    mnemonic: String(o.mnemonic || ''),
    category: Array.isArray(o.category) ? (o.category as string[]) : [],
    synonyms: Array.isArray(o.synonyms) ? (o.synonyms as Word['synonyms']) : [],
    similars: Array.isArray(o.similars) ? (o.similars as Word['similars']) : [],
    derivatives: Array.isArray(o.derivatives) ? (o.derivatives as Word['derivatives']) : [],
    collocations: Array.isArray(o.collocations) ? (o.collocations as Word['collocations']) : [],
    dictCollocations: Array.isArray(o.dictCollocations)
      ? (o.dictCollocations as Word['dictCollocations'])
      : [],
    examples: Array.isArray(o.examples) ? (o.examples as Word['examples']) : [],
    crossedOut: !!o.crossedOut,
    starred: !!o.starred,
    ease: Number(o.ease ?? 2.5),
    interval: Number(o.interval ?? 0),
    streak: Number(o.streak ?? 0),
    nextReview: Number(o.nextReview ?? Date.now()),
    totalReviews: Number(o.totalReviews ?? 0),
    correctReviews: Number(o.correctReviews ?? 0),
    createdAt: Number(o.createdAt ?? Date.now()),
    updatedAt: Number(o.updatedAt ?? Date.now()),
    progressUpdatedAt: Number(
      o.progressUpdatedAt ?? o.progress_updated_at ?? o.updatedAt ?? Date.now()
    ),
    ...(synonymDiff ? { synonymDiff } : {}),
  } as Word & { updatedAt: number };
}

function splitPatchFields(fields: Record<string, unknown>): {
  content: Record<string, unknown>;
  progress: Record<string, unknown>;
} {
  const content: Record<string, unknown> = {};
  const progress: Record<string, unknown> = {};
  const progressKeys = new Set<string>(SRS_FIELD_KEYS);
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'updatedAt') continue;
    if (progressKeys.has(k)) progress[k] = v;
    else content[k] = v;
  }
  return { content, progress };
}

const PULL_PAGE_SIZE = 2000;

async function fetchWordsPage(
  settings: Settings,
  sinceMs: number | undefined,
  cursor: string
): Promise<{
  page: Word[];
  maxUpdatedAt: number;
  nextCursor: string;
}> {
  const params = new URLSearchParams();
  params.set('limit', String(PULL_PAGE_SIZE));
  if (sinceMs && sinceMs > 0) params.set('since', String(sinceMs));
  if (cursor) params.set('cursor', cursor);

  const resp = await fetch(getBase(settings) + '/api/words?' + params.toString(), {
    headers: authHeaders(settings),
  });
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new WordsApiError(String(data.error || `拉取失败 ${resp.status}`), resp.status);
  }
  const list = Array.isArray(data.words) ? data.words : [];
  const page = list.map(parseWord).filter(Boolean) as Word[];
  const next = typeof data.nextCursor === 'string' ? data.nextCursor : '';
  return {
    page,
    maxUpdatedAt: Number(data.maxUpdatedAt || 0),
    nextCursor: next && page.length > 0 ? next : '',
  };
}

export async function fetchWordsSince(
  settings: Settings,
  sinceMs?: number,
  onPage?: (page: Word[], totalSoFar: number) => void | Promise<void>
): Promise<{ words: Word[]; maxUpdatedAt: number }> {
  if (!settings.syncToken) return { words: [], maxUpdatedAt: 0 };

  const words: Word[] = [];
  let maxUpdatedAt = 0;
  let cursor = '';
  let writeChain: Promise<void> = Promise.resolve();

  // 预取下一页 HTTP，与 IndexedDB 写入重叠，减少「等写库再请求」的空档
  let pending = fetchWordsPage(settings, sinceMs, '');

  for (;;) {
    const batch = await pending;
    maxUpdatedAt = Math.max(maxUpdatedAt, batch.maxUpdatedAt);
    words.push(...batch.page);

    if (batch.page.length) {
      const totalSoFar = words.length;
      const pageCopy = batch.page;
      writeChain = writeChain.then(async () => {
        await onPage?.(pageCopy, totalSoFar);
      });
    }

    if (!batch.nextCursor) break;
    cursor = batch.nextCursor;
    pending = fetchWordsPage(settings, sinceMs, cursor);
  }

  await writeChain;

  return {
    words,
    maxUpdatedAt: maxUpdatedAt || Date.now(),
  };
}

export async function putWord(settings: Settings, word: Word): Promise<Word> {
  const body = wordToApiBody({ ...word, updatedAt: Date.now() } as Word);
  const resp = await fetch(
    getBase(settings) + '/api/words/' + encodeURIComponent(word.id),
    {
      method: 'PUT',
      headers: authHeaders(settings),
      body: JSON.stringify(body),
    }
  );
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new WordsApiError(String(data.error || `保存失败 ${resp.status}`), resp.status);
  }
  return (parseWord(data.word) || word) as Word;
}

/**
 * 字段级部分更新：内容走 /api/words，进度走 /api/srs/word/:id。
 * 404 时回退整词 PUT（远端还没有这行）。
 */
export async function patchWordFields(
  settings: Settings,
  wordId: string,
  fields: Record<string, unknown>,
  fallbackWord?: Word
): Promise<Word | null> {
  const { content, progress } = splitPatchFields(fields);
  const hasContent = Object.keys(content).length > 0;
  const hasProgress = Object.keys(progress).length > 0;

  let word: Word | null = null;

  if (hasContent) {
    const resp = await fetch(
      getBase(settings) + '/api/words/' + encodeURIComponent(wordId),
      {
        method: 'PATCH',
        headers: authHeaders(settings),
        body: JSON.stringify({ ...content, updatedAt: Date.now() }),
      }
    );
    const data = await readJson(resp);
    if (!resp.ok) {
      if (resp.status === 404 && fallbackWord) {
        return putWord(settings, fallbackWord);
      }
      throw new WordsApiError(String(data.error || `部分更新失败 ${resp.status}`), resp.status);
    }
    word = parseWord(data.word);
  }

  if (hasProgress) {
    try {
      const srs = await patchSrsFields(settings, 'word', wordId, progress);
      if (srs) {
        const base = word || fallbackWord;
        if (base) word = applySrsToWord(base, srs);
      }
    } catch (e) {
      if (
        e instanceof SrsApiError &&
        e.status === 404 &&
        fallbackWord &&
        !hasContent
      ) {
        return putWord(settings, fallbackWord);
      }
      // Word exists but srs row missing: putSrs then done
      if (fallbackWord && !hasContent) {
        const srs = await putSrs(settings, {
          targetType: 'word',
          targetId: wordId,
          ease: Number(progress.ease ?? fallbackWord.ease ?? 2.5),
          interval: Number(progress.interval ?? fallbackWord.interval ?? 0),
          streak: Number(progress.streak ?? fallbackWord.streak ?? 0),
          nextReview: Number(progress.nextReview ?? fallbackWord.nextReview ?? Date.now()),
          totalReviews: Number(
            progress.totalReviews ?? fallbackWord.totalReviews ?? 0
          ),
          correctReviews: Number(
            progress.correctReviews ?? fallbackWord.correctReviews ?? 0
          ),
          starred: !!(progress.starred ?? fallbackWord.starred),
          crossedOut: !!(progress.crossedOut ?? fallbackWord.crossedOut),
          updatedAt: Date.now(),
        });
        return applySrsToWord(fallbackWord, srs);
      }
      throw e;
    }
  }

  return word;
}

export async function patchWordProgress(
  settings: Settings,
  word: Word
): Promise<Word> {
  const srs = await patchSrsFields(settings, 'word', word.id, {
    ease: word.ease,
    interval: word.interval,
    streak: word.streak,
    nextReview: word.nextReview,
    totalReviews: word.totalReviews,
    correctReviews: word.correctReviews,
    crossedOut: word.crossedOut,
    starred: !!word.starred,
  });
  if (!srs) {
    const put = await putSrs(settings, {
      targetType: 'word',
      targetId: word.id,
      ease: word.ease,
      interval: word.interval,
      streak: word.streak,
      nextReview: word.nextReview,
      totalReviews: word.totalReviews,
      correctReviews: word.correctReviews,
      starred: !!word.starred,
      crossedOut: !!word.crossedOut,
      updatedAt: Date.now(),
    });
    return applySrsToWord(word, put);
  }
  return applySrsToWord(word, srs);
}

export async function deleteWordRemote(settings: Settings, wordId: string): Promise<void> {
  const resp = await fetch(
    getBase(settings) + '/api/words/' + encodeURIComponent(wordId),
    { method: 'DELETE', headers: authHeaders(settings) }
  );
  if (resp.status === 404) return;
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new WordsApiError(String(data.error || `删除失败 ${resp.status}`), resp.status);
  }
}

export async function batchPutWords(
  settings: Settings,
  words: Word[],
  chunkSize = 200
): Promise<number> {
  if (!settings.syncToken || words.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < words.length; i += chunkSize) {
    const slice = words.slice(i, i + chunkSize).map((w) => wordToApiBody(w));
    const resp = await fetch(getBase(settings) + '/api/words/batch', {
      method: 'POST',
      headers: authHeaders(settings),
      body: JSON.stringify({ words: slice }),
    });
    const data = await readJson(resp);
    if (!resp.ok) {
      throw new WordsApiError(String(data.error || `批量上传失败 ${resp.status}`), resp.status);
    }
    total += Number(data.count || slice.length);
  }
  return total;
}

export interface UserPrefsPayload {
  customCategories: string[];
  practice: unknown;
  learningStreak: Record<string, unknown>;
  updatedAt?: number;
}

export async function fetchPrefs(settings: Settings): Promise<UserPrefsPayload | null> {
  if (!settings.syncToken) return null;
  const resp = await fetch(getBase(settings) + '/api/me/prefs', {
    headers: authHeaders(settings),
  });
  const data = await readJson(resp);
  if (!resp.ok) return null;
  const prefs = data.prefs as Record<string, unknown> | undefined;
  if (!prefs) return null;
  return {
    customCategories: Array.isArray(prefs.customCategories)
      ? (prefs.customCategories as string[])
      : [],
    practice: prefs.practice,
    learningStreak:
      prefs.learningStreak && typeof prefs.learningStreak === 'object'
        ? (prefs.learningStreak as Record<string, unknown>)
        : {},
    updatedAt: Number(prefs.updatedAt || 0),
  };
}

export async function putPrefs(
  settings: Settings,
  prefs: UserPrefsPayload
): Promise<void> {
  if (!settings.syncToken) return;
  const resp = await fetch(getBase(settings) + '/api/me/prefs', {
    method: 'PUT',
    headers: authHeaders(settings),
    body: JSON.stringify(prefs),
  });
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new WordsApiError(String(data.error || `偏好同步失败 ${resp.status}`), resp.status);
  }
}

export async function cloudbasePullViaApi(
  settings: Settings,
  cloudbaseUrl: string,
  username: string,
  legacySyncToken?: string
): Promise<string> {
  const resp = await fetch(getBase(settings) + '/api/migrate/cloudbase-pull', {
    method: 'POST',
    headers: authHeaders(settings),
    body: JSON.stringify({
      url: cloudbaseUrl,
      username,
      syncToken: legacySyncToken || '',
    }),
  });
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new WordsApiError(String(data.error || 'CloudBase 代拉失败'), resp.status);
  }
  return typeof data.data === 'string' ? data.data : '';
}
