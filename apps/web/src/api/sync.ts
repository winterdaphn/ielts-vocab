/**
 * Cloud sync payload build/apply (v3 patch format only).
 *
 *   - patches[] / custom[] — user overlays + SRS
 *   - state / encrypted — streak, practice, settings
 */

import type { Settings } from '@/types/settings';
import type { Word } from '@/types/word';
import { decryptJSON, encryptJSON, type EncryptedPayload } from '@/api/crypto';
import { downloadAll, uploadAll, type SyncPayload, type UploadResult } from '@/api/cloud';
import { useWordsStore } from '@/store/useWords';
import { useSettings } from '@/store/useSettings';
import { useCategories } from '@/store/useCategories';
import { getLS, setLS, lsKey } from '@/utils/date';
import {
  applyPracticeSyncSnapshot,
  getPracticeSyncSnapshot,
  normalizePracticeSyncPayload,
} from '@/utils/practiceSession';
import {
  SYNC_FORMAT_VERSION,
  buildSyncPatches,
  mergeSyncIntoWords,
  type CustomWordSync,
  type WordSyncPatch,
} from '@/utils/wordSyncPatch';

export interface ApplySyncResult {
  /** Words newly created from cloud */
  added: number;
  /** Existing local words that received overlay updates */
  patched: number;
  /** @deprecated use patched; true when any word data applied */
  replaced: boolean;
  needsPassword: boolean;
  decrypted: boolean;
  practiceRestored: boolean;
}

function applyPracticeFromSources(
  statePractice: unknown,
  decryptedSession: unknown
): boolean {
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

function mergeCustomCategories(raw: unknown): void {
  if (!Array.isArray(raw)) return;
  const add = useCategories.getState().addCustom;
  for (const item of raw) {
    const name = String(item || '').trim();
    if (name) add(name);
  }
}

/** Merge patch payload into IndexedDB (no full wipe). */
export async function mergeLocalFromPatches(
  patches: WordSyncPatch[],
  customs: CustomWordSync[]
): Promise<{ added: number; patched: number }> {
  const local = await loadLocalWordsFallback();
  const { words, patched, added } = await mergeSyncIntoWords(local, patches, customs);
  if (patched > 0 || added > 0) {
    await useWordsStore.getState().replaceAll(words);
  }
  return { added, patched };
}

/** LiveQuery may lag; read Dexie directly when store snapshot is empty. */
async function loadLocalWordsFallback(): Promise<Word[]> {
  const { db } = await import('@/db/ieltsDb');
  const { useAuth } = await import('@/store/useAuth');
  const userId = useAuth.getState().username;
  if (!userId) return [];
  return (await db.words.where('userId').equals(userId).toArray()) as Word[];
}

export async function applySyncPayload(
  data: SyncPayload | null,
  password: string,
  username: string
): Promise<ApplySyncResult> {
  if (!data || typeof data !== 'object') {
    return {
      added: 0,
      patched: 0,
      replaced: false,
      needsPassword: false,
      decrypted: false,
      practiceRestored: false,
    };
  }

  let decrypted: Record<string, unknown> | null = null;
  let needsPassword = false;

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
  let patched = 0;

  const result = await mergeLocalFromPatches(
    Array.isArray(data.patches) ? data.patches : [],
    Array.isArray(data.custom) ? (data.custom as CustomWordSync[]) : []
  );
  added = result.added;
  patched = result.patched;

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
    mergeCustomCategories(st.customCategories);
  }

  if (Array.isArray(data.customCategories)) {
    mergeCustomCategories(data.customCategories);
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
    patched,
    replaced: added > 0 || patched > 0,
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
  const { patches, custom } = await buildSyncPatches(words);
  const customCategories = useCategories
    .getState()
    .custom.filter(Boolean);

  const stateObj = {
    streak: getLS('streak') || '0',
    lastDay: getLS('last-day') || '',
    practice,
    customCategories,
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
    session: practice,
  };

  let encrypted: EncryptedPayload | null = null;
  if (password) {
    encrypted = await encryptJSON(sensitive, password, username);
  }

  return {
    v: SYNC_FORMAT_VERSION,
    patches,
    custom,
    customCategories,
    // Empty words[] for backward-compatible payload shape
    words: [],
    state: { ...stateObj, todayDone },
    meta: {
      lastSyncAt: Date.now(),
      format: 'patch-v3',
      patchCount: patches.length,
      customCount: custom.length,
      localWordCount: words.length,
      hasPractice: !!practice,
      practiceIdx: practice ? practice.idx + 1 : 0,
      practiceTotal: practice ? practice.wordIds.length : 0,
    },
    encrypted,
  };
}

/** Pull from cloud and merge locally. */
export async function pullFromCloud(
  settings: Settings,
  username: string,
  password: string
): Promise<ApplySyncResult> {
  const data = await downloadAll(settings, username);
  if (!data) {
    return {
      added: 0,
      patched: 0,
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

export interface PushToCloudResult {
  payload: SyncPayload;
  upload: UploadResult;
}

/** Build compact payload and push to cloud. */
export async function pushToCloud(
  words: Word[],
  settings: Settings,
  username: string,
  password: string
): Promise<PushToCloudResult> {
  const payload = await buildSyncPayload(words, settings, password, username);
  const upload = await uploadAll(settings, username, payload);
  useSettings.getState().update({ lastSyncAt: Date.now() });
  return { payload, upload };
}
