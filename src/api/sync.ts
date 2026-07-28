/**
 * Cloud sync payload build/apply — mirrors example.html getSyncPayload / applySyncPayload.
 *
 * Cloud shape:
 *   - words[]   — plaintext vocab + SRS fields (source of truth for the word list)
 *   - state     — streak / lastDay / todayDone / practice (compact resume)
 *   - encrypted — sensitive settings + practice session (password-gated)
 *
 * Practice sync is intentionally compact: mode + wordIds + idx + stats.
 * In-progress answers and prefetched sentences are not uploaded; remaining
 * questions regenerate when the learner opens practice on another device.
 */

import type { Settings } from '@/types/settings';
import type { Word } from '@/types/word';
import { decryptJSON, encryptJSON, type EncryptedPayload } from '@/api/crypto';
import { fetchAll, pushAll, type SyncPayload } from '@/api/cloud';
import { useWordsStore, makeNewWord } from '@/store/useWords';
import { useSettings } from '@/store/useSettings';
import { getLS, setLS, lsKey } from '@/utils/date';
import {
  applyPracticeSyncSnapshot,
  getPracticeSyncSnapshot,
  normalizePracticeSyncPayload,
} from '@/utils/practiceSession';

export interface ApplySyncResult {
  added: number;
  replaced: boolean;
  needsPassword: boolean;
  decrypted: boolean;
  practiceRestored: boolean;
}

function normalizeCloudWord(raw: Partial<Word> & { word?: string }): Word | null {
  if (!raw || !raw.word) return null;
  return makeNewWord({
    id: raw.id,
    word: String(raw.word),
    translation: String(raw.translation || ''),
    phonetic: raw.phonetic || '',
    partOfSpeech: raw.partOfSpeech || '',
    mnemonic: raw.mnemonic || '',
    synonyms: Array.isArray(raw.synonyms) ? raw.synonyms : [],
    similars: Array.isArray(raw.similars) ? raw.similars : [],
    examples: Array.isArray(raw.examples) ? raw.examples : [],
    crossedOut: raw.crossedOut ?? false,
    ease: raw.ease ?? 2.5,
    interval: raw.interval ?? 0,
    streak: raw.streak ?? 0,
    nextReview: raw.nextReview ?? Date.now(),
    totalReviews: raw.totalReviews ?? 0,
    correctReviews: raw.correctReviews ?? 0,
    createdAt: raw.createdAt ?? Date.now(),
  });
}

/** Replace local IndexedDB word list for current user (like example dbClear + dbPut loop). */
export async function replaceLocalWords(cloudWords: unknown[]): Promise<number> {
  const normalized: Word[] = [];
  for (const item of cloudWords) {
    const w = normalizeCloudWord(item as Partial<Word> & { word?: string });
    if (w) normalized.push(w);
  }
  await useWordsStore.getState().replaceAll(normalized);
  return normalized.length;
}

function applyPracticeFromSources(
  statePractice: unknown,
  decryptedSession: unknown
): boolean {
  // Prefer plaintext state.practice; fall back to encrypted.session (example.html)
  const fromState = normalizePracticeSyncPayload(statePractice);
  const fromEncrypted =
    fromState === undefined
      ? normalizePracticeSyncPayload(decryptedSession)
      : undefined;

  const snap = fromState !== undefined ? fromState : fromEncrypted;
  if (snap === undefined) return false;
  applyPracticeSyncSnapshot(snap);
  return true;
}

export async function applySyncPayload(
  data: SyncPayload | null,
  password: string,
  username: string
): Promise<ApplySyncResult> {
  if (!data || typeof data !== 'object') {
    return {
      added: 0,
      replaced: false,
      needsPassword: false,
      decrypted: false,
      practiceRestored: false,
    };
  }

  let decrypted: Record<string, unknown> | null = null;
  let needsPassword = false;

  // Encrypted blob holds sensitive settings + optional practice session
  if (data.encrypted) {
    if (!password) {
      needsPassword = true;
    } else {
      try {
        decrypted = await decryptJSON<Record<string, unknown>>(
          data.encrypted as EncryptedPayload,
          password,
          username
        );
      } catch {
        needsPassword = true;
        decrypted = null;
      }
    }
  }

  let added = 0;
  let replaced = false;

  // Plaintext words[] is the source of truth — apply even if settings decrypt fails
  if (Array.isArray(data.words)) {
    added = await replaceLocalWords(data.words);
    replaced = true;
  }

  if (data.state && typeof data.state === 'object') {
    const st = data.state as Record<string, unknown>;
    if (st.streak !== undefined) setLS('streak', String(st.streak));
    if (st.lastDay !== undefined) setLS('last-day', String(st.lastDay ?? ''));
    if (st.todayDone && typeof st.todayDone === 'object') {
      for (const [k, v] of Object.entries(st.todayDone as Record<string, string>)) {
        try {
          localStorage.setItem(k, v);
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (decrypted) {
    const patch: Partial<Settings> = {};
    if (typeof decrypted.apiKey === 'string' && decrypted.apiKey) patch.apiKey = decrypted.apiKey;
    if (typeof decrypted.syncToken === 'string') patch.syncToken = decrypted.syncToken;
    if (typeof decrypted.apiBase === 'string' && decrypted.apiBase) patch.apiBase = decrypted.apiBase;
    if (typeof decrypted.model === 'string' && decrypted.model) patch.model = decrypted.model;
    if (
      decrypted.provider === 'openai' ||
      decrypted.provider === 'deepseek' ||
      decrypted.provider === 'moonshot' ||
      decrypted.provider === 'zhipu' ||
      decrypted.provider === 'custom'
    ) {
      patch.provider = decrypted.provider;
    }
    if (Object.keys(patch).length > 0) {
      useSettings.getState().update(patch);
    }
  }

  const statePractice =
    data.state && typeof data.state === 'object'
      ? (data.state as Record<string, unknown>).practice
      : undefined;
  const practiceRestored = applyPracticeFromSources(
    statePractice,
    decrypted?.session
  );

  return {
    added,
    replaced,
    needsPassword,
    decrypted: !!decrypted,
    practiceRestored,
  };
}

export async function buildSyncPayload(
  words: Word[],
  settings: Settings,
  password: string,
  username: string
): Promise<SyncPayload> {
  const practice = getPracticeSyncSnapshot();

  const stateObj = {
    streak: getLS('streak') || '0',
    lastDay: getLS('last-day') || '',
    /** Compact unfinished practice — null clears continue-card on other devices */
    practice,
  };

  const todayDone: Record<string, string> = {};
  const donePrefix = lsKey('done-');
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(donePrefix)) {
        const v = localStorage.getItem(k);
        if (v != null) todayDone[k] = v;
      }
    }
  } catch {
    /* ignore */
  }

  const sensitive = {
    apiKey: settings.apiKey || '',
    syncToken: settings.syncToken || '',
    provider: settings.provider || 'openai',
    apiBase: settings.apiBase || '',
    model: settings.model || '',
    // Same compact snapshot inside encrypted blob (example.html-compatible slot)
    session: practice,
  };

  let encrypted: EncryptedPayload | null = null;
  if (password) {
    encrypted = await encryptJSON(sensitive, password, username);
  }

  return {
    words: words.map((w) => ({ ...w })),
    state: { ...stateObj, todayDone },
    meta: {
      lastSyncAt: Date.now(),
      hasPractice: !!practice,
      practiceIdx: practice ? practice.idx + 1 : 0,
      practiceTotal: practice ? practice.wordIds.length : 0,
    },
    encrypted,
  };
}

/** Pull from cloud and apply locally. */
export async function pullFromCloud(
  settings: Settings,
  username: string,
  password: string
): Promise<ApplySyncResult> {
  const data = await fetchAll(settings, username);
  if (!data) {
    return {
      added: 0,
      replaced: false,
      needsPassword: false,
      decrypted: false,
      practiceRestored: false,
    };
  }
  const result = await applySyncPayload(data, password, username);
  if (result.replaced || result.decrypted || result.practiceRestored) {
    useSettings.getState().update({ lastSyncAt: Date.now() });
  }
  return result;
}

/** Build payload and push to cloud. */
export async function pushToCloud(
  words: Word[],
  settings: Settings,
  username: string,
  password: string
): Promise<SyncPayload> {
  const payload = await buildSyncPayload(words, settings, password, username);
  await pushAll(settings, username, payload);
  useSettings.getState().update({ lastSyncAt: Date.now() });
  return payload;
}
