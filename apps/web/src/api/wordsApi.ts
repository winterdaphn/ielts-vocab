/**
 * Relational words / prefs API client (JWT Bearer).
 */
import type { Settings } from '@/types/settings';
import type { Word } from '@/types/word';

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

/** Strip local-only fields before upload */
export function wordToApiBody(w: Word): Record<string, unknown> {
  const { synonymDiff: _sd, ...rest } = w as Word & { synonymDiff?: unknown };
  return {
    id: rest.id,
    word: rest.word,
    translation: rest.translation || '',
    phoneticUs: rest.phoneticUs || '',
    phoneticUk: rest.phoneticUk || '',
    partOfSpeech: rest.partOfSpeech || '',
    mnemonic: rest.mnemonic || '',
    category: rest.category || [],
    synonyms: rest.synonyms || [],
    similars: rest.similars || [],
    derivatives: rest.derivatives || [],
    collocations: rest.collocations || [],
    dictCollocations: rest.dictCollocations || [],
    examples: rest.examples || [],
    crossedOut: !!rest.crossedOut,
    starred: !!rest.starred,
    ease: rest.ease ?? 2.5,
    interval: rest.interval ?? 0,
    streak: rest.streak ?? 0,
    nextReview: rest.nextReview ?? Date.now(),
    totalReviews: rest.totalReviews ?? 0,
    correctReviews: rest.correctReviews ?? 0,
    createdAt: rest.createdAt ?? Date.now(),
    updatedAt: (rest as Word & { updatedAt?: number }).updatedAt ?? Date.now(),
  };
}

function parseWord(raw: unknown): Word | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '').trim();
  const word = String(o.word || id).trim();
  if (!id && !word) return null;
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
  } as Word & { updatedAt: number };
}

const PULL_PAGE_SIZE = 200;

export async function fetchWordsSince(
  settings: Settings,
  sinceMs?: number,
  onPage?: (page: Word[], totalSoFar: number) => void | Promise<void>
): Promise<{ words: Word[]; maxUpdatedAt: number }> {
  if (!settings.syncToken) return { words: [], maxUpdatedAt: 0 };

  const words: Word[] = [];
  let maxUpdatedAt = 0;
  let cursor = '';

  for (;;) {
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
    words.push(...page);
    maxUpdatedAt = Math.max(maxUpdatedAt, Number(data.maxUpdatedAt || 0));
    if (page.length) await onPage?.(page, words.length);

    const next = typeof data.nextCursor === 'string' ? data.nextCursor : '';
    if (!next || page.length === 0) break;
    cursor = next;
  }

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

export async function patchWordProgress(
  settings: Settings,
  word: Word
): Promise<Word> {
  const resp = await fetch(
    getBase(settings) + '/api/words/' + encodeURIComponent(word.id) + '/progress',
    {
      method: 'PATCH',
      headers: authHeaders(settings),
      body: JSON.stringify({
        ease: word.ease,
        interval: word.interval,
        streak: word.streak,
        nextReview: word.nextReview,
        totalReviews: word.totalReviews,
        correctReviews: word.correctReviews,
        crossedOut: word.crossedOut,
        starred: !!word.starred,
      }),
    }
  );
  const data = await readJson(resp);
  if (!resp.ok) {
    // Row missing remotely — fall back to full put
    if (resp.status === 404) return putWord(settings, word);
    throw new WordsApiError(String(data.error || `进度同步失败 ${resp.status}`), resp.status);
  }
  return (parseWord(data.word) || word) as Word;
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
