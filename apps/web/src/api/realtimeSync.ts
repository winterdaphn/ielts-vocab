/**
 * Auto incremental sync queue — debounce local Dexie writes to REST.
 */
import type { Word } from '@/types/word';
import { useSettings } from '@/store/useSettings';
import { useWordsStore } from '@/store/useWords';
import { useCategories } from '@/store/useCategories';
import { getLS, setLS } from '@/utils/date';
import {
  applyPracticeSyncSnapshot,
  getPracticeSyncSnapshot,
  normalizePracticeSyncPayload,
} from '@/utils/practiceSession';
import {
  batchPutWords,
  deleteWordRemote,
  fetchPrefs,
  fetchWordsSince,
  patchWordProgress,
  putPrefs,
  putWord,
} from '@/api/wordsApi';
import { useSyncStatus } from '@/store/useSyncStatus';

export type SyncKind = 'content' | 'progress' | 'delete';

interface QueueItem {
  kind: SyncKind;
  word?: Word;
  wordId?: string;
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
]);

const queue = new Map<string, QueueItem>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let failToastAt = 0;

function settings() {
  return useSettings.getState();
}

export function classifyWordChange(prev: Word | null | undefined, next: Word): SyncKind {
  if (!prev) return 'content';
  let content = false;
  let progress = false;
  for (const k of CONTENT_KEYS) {
    if (JSON.stringify((prev as never)[k]) !== JSON.stringify((next as never)[k])) {
      content = true;
    }
  }
  for (const k of PROGRESS_KEYS) {
    if (JSON.stringify((prev as never)[k]) !== JSON.stringify((next as never)[k])) {
      progress = true;
    }
  }
  if (content) return 'content';
  if (progress) return 'progress';
  return 'content';
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

  const resolved = kind || classifyWordChange(prev, word);
  const existing = queue.get(word.id);
  if (existing?.kind === 'delete') return;
  if (existing?.kind === 'content' || resolved === 'content') {
    queue.set(word.id, { kind: 'content', word: { ...word, updatedAt: Date.now() } as Word });
  } else {
    queue.set(word.id, { kind: 'progress', word: { ...word, updatedAt: Date.now() } as Word });
  }
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
      } else if (item.kind === 'progress' && item.word) {
        await patchWordProgress(s, item.word);
      } else if (item.word) {
        await putWord(s, item.word);
      }
    }
    useSettings.getState().update({ lastSyncAt: Date.now() });
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
export async function pullIncremental(): Promise<{ merged: number }> {
  const s = settings();
  if (!s.syncToken) return { merged: 0 };

  const sync = useSyncStatus.getState();
  const since = s.lastSyncAt > 0 ? s.lastSyncAt : undefined;
  const fullPull = !since;
  sync.beginPull();

  try {
    const { db } = await import('@/db/ieltsDb');
    const { useAuth } = await import('@/store/useAuth');
    const userId = useAuth.getState().username;
    if (!userId) return { merged: 0 };

    const localRows = (await db.words.where('userId').equals(userId).toArray()) as Word[];
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
              // First page: wipe local then seed — UI 立刻有词
              await useWordsStore.getState().replaceAll(accepted);
              clearedForFullPull = true;
            } else {
              await useWordsStore.getState().addWords(accepted);
            }
          });
        }
        sync.setPulledCount(fullPull ? map.size : totalSoFar);
      }
    );
    maxUpdatedAt = remoteMax;

    if (remote.length === 0) {
      const prefs = await fetchPrefs(s);
      if (prefs) applyPrefsLocally(prefs);
      if (maxUpdatedAt) useSettings.getState().update({ lastSyncAt: maxUpdatedAt });
      return { merged: 0 };
    }

    if (!fullPull) {
      await withSyncSuspended(() => useWordsStore.getState().replaceAll([...map.values()]));
    } else if (!clearedForFullPull) {
      await withSyncSuspended(() => useWordsStore.getState().replaceAll([...map.values()]));
    }

    const prefs = await fetchPrefs(s);
    if (prefs) applyPrefsLocally(prefs);

    useSettings.getState().update({
      lastSyncAt: Math.max(maxUpdatedAt, Date.now()),
    });
    return { merged };
  } finally {
    sync.endPull();
  }
}

function applyPrefsLocally(prefs: {
  customCategories: string[];
  practice: unknown;
  learningStreak: Record<string, unknown>;
}) {
  if (prefs.customCategories.length) {
    const add = useCategories.getState().addCustom;
    for (const c of prefs.customCategories) {
      if (c) add(c);
    }
  }
  const streak = prefs.learningStreak || {};
  if (streak.count != null) setLS('streak', String(streak.count));
  if (streak.lastDay != null) setLS('last-day', String(streak.lastDay));
  const snap = normalizePracticeSyncPayload(prefs.practice);
  if (snap) applyPracticeSyncSnapshot(snap);
}

export async function pushPrefsNow(): Promise<void> {
  const s = settings();
  if (!s.syncToken) return;
  await putPrefs(s, {
    customCategories: useCategories.getState().custom.filter(Boolean),
    practice: getPracticeSyncSnapshot(),
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
    return await pullIncremental();
  } catch (e) {
    useSettings.getState().update({ lastSyncAt: prev });
    throw e;
  }
}
