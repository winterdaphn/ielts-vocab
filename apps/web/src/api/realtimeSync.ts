/**
 * Auto incremental sync queue — debounce local Dexie writes to REST.
 *
 * 推送尽量走字段级 PATCH，避免整词大包：
 * - 新建词（无 prev）→ PUT 整词
 * - 只改复习进度 → PATCH 进度字段
 * - 改助记 / 例句 / 近义等 → PATCH 仅变更字段（不是整词）
 *
 * 1s 内同一词多次变更会合并 fields；content 与 progress 可打在同一次 PATCH。
 */
import type { Word } from '@/types/word';
import { toPersistedSynonymDiff } from '@/utils/synonymDiffStorage';
import type { StoredSynonymDiff } from '@/types/word';
import { useSettings } from '@/store/useSettings';
import { useWordsStore } from '@/store/useWords';
import { useCategories } from '@/store/useCategories';
import { getLS, setLS } from '@/utils/date';
import {
  applyPracticeSyncSnapshot,
  clearPracticeSession,
  normalizePracticeSyncPayload,
} from '@/utils/practiceSession';
import { abandonCloudPracticeSession, endCloudPracticeSession } from '@/api/practiceCloudSync';
import {
  batchPutWords,
  deleteWordRemote,
  fetchPrefs,
  fetchWordsSince,
  patchWordFields,
  putPrefs,
  putWord,
} from '@/api/wordsApi';
import { useSyncStatus } from '@/store/useSyncStatus';

export type SyncKind = 'content' | 'progress' | 'delete';

export type PullReason =
  | 'login'
  | 'cold-start'
  | 'interval'
  | 'manual'
  | 'background';

function syncLog(message: string, detail?: unknown) {
  if (detail !== undefined) {
    console.info('[sync]', message, detail);
  } else {
    console.info('[sync]', message);
  }
}

let pullInFlight: Promise<{ merged: number }> | null = null;

interface QueueItem {
  kind: SyncKind;
  word?: Word;
  wordId?: string;
  /** 字段级补丁；与 fullPut 互斥 */
  fields?: Record<string, unknown>;
  /** 新建词：必须整词 PUT */
  fullPut?: boolean;
}

const PROGRESS_KEYS = new Set([
  'ease',
  'interval',
  'streak',
  'nextReview',
  'totalReviews',
  'correctReviews',
  'crossedOut',
  'starred',
]);

const CONTENT_KEYS = new Set([
  'word',
  'translation',
  'phoneticUs',
  'phoneticUk',
  'partOfSpeech',
  'mnemonic',
  'category',
  'synonyms',
  'similars',
  'derivatives',
  'collocations',
  'dictCollocations',
  'examples',
  'synonymDiff',
]);

const TRACKED_KEYS = [...CONTENT_KEYS, ...PROGRESS_KEYS];

const queue = new Map<string, QueueItem>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let failToastAt = 0;

function settings() {
  return useSettings.getState();
}

function fieldValue(word: Word, key: string): unknown {
  return (word as unknown as Record<string, unknown>)[key];
}

/** 只收集 prev→next 真正变了的字段 */
export function diffWordFields(
  prev: Word | null | undefined,
  next: Word
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (!prev) return fields;
  for (const key of TRACKED_KEYS) {
    const a = fieldValue(prev, key);
    let b = fieldValue(next, key);
    if (key === 'synonymDiff' && b && typeof b === 'object') {
      const sd = b as StoredSynonymDiff;
      if (sd.key) b = toPersistedSynonymDiff(sd.key, sd);
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      fields[key] = b;
    }
  }
  return fields;
}

export function classifyWordChange(prev: Word | null | undefined, next: Word): SyncKind {
  // 没有旧快照时：若调用方没强制 kind，按 progress 处理；
  // 真正新建应走 enqueueWord(..., 'content') → fullPut。
  if (!prev) return 'progress';
  const fields = diffWordFields(prev, next);
  for (const key of Object.keys(fields)) {
    if (CONTENT_KEYS.has(key)) return 'content';
  }
  for (const key of Object.keys(fields)) {
    if (PROGRESS_KEYS.has(key)) return 'progress';
  }
  return 'progress';
}

function scheduleFlush() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void flushSyncQueue();
  }, 1000);
}

let syncSuspended = false;

/** Temporarily disable enqueue (e.g. during remote pull / replaceAll). */
export function withSyncSuspended<T>(fn: () => Promise<T>): Promise<T> {
  syncSuspended = true;
  return fn().finally(() => {
    syncSuspended = false;
  });
}

export function enqueueWord(word: Word, kind?: SyncKind, prev?: Word | null) {
  if (syncSuspended) return;
  const s = settings();
  if (!s.syncToken || !s.autoSync) return;

  const now = Date.now();
  const next = { ...word, updatedAt: now } as Word;
  const existing = queue.get(word.id);
  if (existing?.kind === 'delete') return;

  // 新建词：强制整词 PUT
  const isCreate = kind === 'content' && !prev;
  if (isCreate || existing?.fullPut) {
    queue.set(word.id, { kind: 'content', word: next, fullPut: true });
    scheduleFlush();
    return;
  }

  const resolved = kind || classifyWordChange(prev, next);
  const delta = prev ? diffWordFields(prev, next) : {};
  if (!prev) {
    // 无快照的更新：只推进度小包，缺行时由 patch 404 fallback PUT
    const progressOnly: Record<string, unknown> = {
      ease: next.ease,
      interval: next.interval,
      streak: next.streak,
      nextReview: next.nextReview,
      totalReviews: next.totalReviews,
      correctReviews: next.correctReviews,
      crossedOut: next.crossedOut,
      starred: !!next.starred,
      updatedAt: now,
    };
    queue.set(word.id, {
      kind: 'progress',
      word: next,
      fields: { ...(existing?.fields || {}), ...progressOnly },
    });
    scheduleFlush();
    return;
  }

  if (Object.keys(delta).length === 0) return;

  const mergedFields = { ...(existing?.fields || {}), ...delta, updatedAt: now };
  const nextKind =
    existing?.kind === 'content' || resolved === 'content' ? 'content' : 'progress';
  queue.set(word.id, {
    kind: nextKind,
    word: next,
    fields: mergedFields,
  });
  scheduleFlush();
}

export function enqueueDelete(wordId: string) {
  if (syncSuspended) return;
  const s = settings();
  if (!s.syncToken || !s.autoSync) return;
  queue.set(wordId, { kind: 'delete', wordId });
  scheduleFlush();
}

export async function flushSyncQueue(): Promise<void> {
  if (flushing) return;
  const s = settings();
  if (!s.syncToken) return;
  if (queue.size === 0) return;

  flushing = true;
  const items = [...queue.values()];
  queue.clear();
  try {
    for (const item of items) {
      if (item.kind === 'delete' && item.wordId) {
        await deleteWordRemote(s, item.wordId);
      } else if (item.fullPut && item.word) {
        await putWord(s, item.word);
      } else if (item.fields && item.word) {
        await patchWordFields(s, item.word.id, item.fields, item.word);
      } else if (item.word) {
        // 兜底：不应常见
        await putWord(s, item.word);
      }
    }
    useSettings.getState().update({ lastSyncAt: Date.now() });
    syncLog('push queue flushed', { count: items.length });
  } catch (e) {
    // re-queue failed items
    for (const item of items) {
      const id = item.wordId || item.word?.id;
      if (id && !queue.has(id)) queue.set(id, item);
    }
    const now = Date.now();
    if (now - failToastAt > 60_000) {
      failToastAt = now;
      console.warn('auto sync failed', e);
    }
    scheduleFlush();
  } finally {
    flushing = false;
  }
}

/** Pull remote changes since lastSyncAt and merge into Dexie (LWW by updatedAt). */
export async function pullIncremental(opts?: {
  reason?: PullReason;
  /** 默认 false：避免切标签/定时拉取时用服务器旧练习进度覆盖本机 */
  applyPracticePrefs?: boolean;
}): Promise<{ merged: number }> {
  if (pullInFlight) return pullInFlight;

  const reason = opts?.reason ?? 'background';
  const applyPracticePrefs = opts?.applyPracticePrefs ?? reason === 'login';

  pullInFlight = pullIncrementalInner(reason, applyPracticePrefs).finally(() => {
    pullInFlight = null;
  });
  return pullInFlight;
}

async function pullIncrementalInner(
  reason: PullReason,
  applyPracticePrefs: boolean
): Promise<{ merged: number }> {
  const s = settings();
  if (!s.syncToken) return { merged: 0 };

  const sync = useSyncStatus.getState();
  const since = s.lastSyncAt > 0 ? s.lastSyncAt : undefined;
  const fullPull = !since;
  sync.setPulling(true);
  syncLog(`pull start (${reason})`, { fullPull, since: since ?? 0 });

  try {
    const { db } = await import('@/db/ieltsDb');
    const { useAuth } = await import('@/store/useAuth');
    const userId = useAuth.getState().username;
    if (!userId) return { merged: 0 };

    const localCount = await db.words.where('userId').equals(userId).count();
    const localRows =
      localCount > 0
        ? ((await db.words.where('userId').equals(userId).toArray()) as Word[])
        : [];
    const map = new Map(localRows.map((w) => [w.id, w]));
    let merged = 0;
    let maxUpdatedAt = 0;
    let clearedForFullPull = false;

    const { words: remote, maxUpdatedAt: remoteMax } = await fetchWordsSince(
      s,
      since,
      async (page, totalSoFar) => {
        const accepted: Word[] = [];
        for (const rw of page) {
          const lw = map.get(rw.id);
          const rUpdated = Number((rw as Word & { updatedAt?: number }).updatedAt || 0);
          const lUpdated = Number(
            (lw as (Word & { updatedAt?: number }) | undefined)?.updatedAt || 0
          );
          if (!lw || rUpdated >= lUpdated) {
            const next = { ...lw, ...rw, id: rw.id } as Word;
            map.set(rw.id, next);
            accepted.push(next);
            merged++;
          }
        }
        if (fullPull && accepted.length) {
          await withSyncSuspended(async () => {
            if (!clearedForFullPull) {
              if (localCount === 0) {
                await useWordsStore.getState().bulkMergeWords(accepted);
              } else {
                await useWordsStore.getState().replaceAll(accepted);
              }
              clearedForFullPull = true;
            } else {
              await useWordsStore.getState().addWords(accepted);
            }
          });
        }
      }
    );
    maxUpdatedAt = remoteMax;

    if (remote.length === 0) {
      const prefs = await fetchPrefs(s);
      if (prefs) applyPrefsLocally(prefs, { applyPracticePrefs });
      if (maxUpdatedAt) useSettings.getState().update({ lastSyncAt: maxUpdatedAt });
      syncLog(`pull done (${reason})`, { merged: 0 });
      return { merged: 0 };
    }

    if (!fullPull) {
      await withSyncSuspended(() =>
        useWordsStore.getState().bulkMergeWords([...map.values()])
      );
    } else if (!clearedForFullPull) {
      await withSyncSuspended(() => useWordsStore.getState().replaceAll([...map.values()]));
    } else if (localCount === 0 && map.size > 0) {
      useWordsStore.getState().setWords([...map.values()]);
    }

    const prefs = await fetchPrefs(s);
    if (prefs) applyPrefsLocally(prefs, { applyPracticePrefs });

    useSettings.getState().update({
      lastSyncAt: Math.max(maxUpdatedAt, Date.now()),
    });
    syncLog(`pull done (${reason})`, { merged });
    return { merged };
  } finally {
    sync.setPulling(false);
  }
}

function applyPrefsLocally(
  prefs: {
    customCategories: string[];
    practice: unknown;
    learningStreak: Record<string, unknown>;
  },
  opts?: { applyPracticePrefs?: boolean }
) {
  if (prefs.customCategories.length) {
    const add = useCategories.getState().addCustom;
    for (const c of prefs.customCategories) {
      if (c) add(c);
    }
  }
  const streak = prefs.learningStreak || {};
  if (streak.count != null) setLS('streak', String(streak.count));
  if (streak.lastDay != null) setLS('last-day', String(streak.lastDay));
  if (opts?.applyPracticePrefs) {
    const snap = normalizePracticeSyncPayload(prefs.practice);
    if (snap) applyPracticeSyncSnapshot(snap);
  }
}

let practicePrefsPushTimer: ReturnType<typeof setTimeout> | null = null;

/** @deprecated 练习会话改走 /api/practice；保留 prefs 仅同步 streak / 分组 */
export function schedulePracticePrefsPush(): void {
  if (practicePrefsPushTimer) clearTimeout(practicePrefsPushTimer);
  practicePrefsPushTimer = setTimeout(() => {
    practicePrefsPushTimer = null;
    void pushPrefsNow();
  }, 2500);
}

/** 清除本地未完成练习；默认同时处理云端会话。
 * 新开一轮请传 `{ cloud: false }`：本机清掉即可，随后 POST /sessions 会删旧 active，避免 abandon + create 双请求。
 */
export function clearPracticeProgress(opts?: {
  completed?: boolean;
  /** 默认 true；新开练时应 false，交给 create 删旧会话 */
  cloud?: boolean;
}): void {
  clearPracticeSession();
  if (practicePrefsPushTimer) {
    clearTimeout(practicePrefsPushTimer);
    practicePrefsPushTimer = null;
  }
  if (opts?.cloud !== false) {
    void (opts?.completed ? endCloudPracticeSession() : abandonCloudPracticeSession());
  }
  void pushPrefsNow();
}

export async function pushPrefsNow(): Promise<void> {
  const s = settings();
  if (!s.syncToken) return;
  await putPrefs(s, {
    customCategories: useCategories.getState().custom.filter(Boolean),
    practice: null,
    learningStreak: {
      count: getLS('streak') || '0',
      lastDay: getLS('last-day') || '',
    },
  });
}

/** Full upload of current local words (migration / manual sync). */
export async function pushAllWordsNow(): Promise<number> {
  const s = settings();
  if (!s.syncToken) return 0;
  await flushSyncQueue();
  const { db } = await import('@/db/ieltsDb');
  const { useAuth } = await import('@/store/useAuth');
  const userId = useAuth.getState().username;
  const words = userId
    ? ((await db.words.where('userId').equals(userId).toArray()) as Word[])
    : useWordsStore.getState().words;
  const n = await batchPutWords(s, words);
  await pushPrefsNow();
  useSettings.getState().update({ lastSyncAt: Date.now() });
  return n;
}

/** First login: full pull if lastSyncAt is 0. */
export async function pullOnLogin(): Promise<{ merged: number }> {
  const s = settings();
  if (!s.syncToken) return { merged: 0 };
  // Force full pull once by clearing since
  const prev = s.lastSyncAt;
  useSettings.getState().update({ lastSyncAt: 0 });
  try {
    return await pullIncremental({ reason: 'login', applyPracticePrefs: true });
  } catch (e) {
    useSettings.getState().update({ lastSyncAt: prev });
    throw e;
  }
}
