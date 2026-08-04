/**
 * Words store — wraps Dexie + provides imperative helpers.
 * Words are scoped to current user; switching users clears the in-memory list.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useLiveQuery } from 'dexie-react-hooks';import { db, dbClearForUser, dbPut, dbDelete, type WordRow } from '@/db/ieltsDb';
import type { Word } from '@/types/word';
import { useAuth } from './useAuth';
import { normalizeCategories } from '@/config/categories';
import { migratePhoneticFields } from '@/utils/phonetic';
import { migrateUserWordIdsIfNeeded } from '@/utils/migrateWordIds';
import { wordToId, withCanonicalWordId } from '@/utils/wordId';

interface WordsState {
  words: Word[];
  loaded: boolean;
  setWords: (w: Word[]) => void;
  addWord: (w: Word) => Promise<void>;
  /** Bulk insert without clearing existing rows. */
  addWords: (words: Word[]) => Promise<void>;
  /** Bulk update existing rows by id. */
  updateWords: (words: Word[]) => Promise<void>;
  updateWord: (w: Word) => Promise<void>;
  removeWord: (id: string) => Promise<void>;
  clearForUser: (userId: string) => Promise<void>;
  /** Clear current user's IndexedDB rows and write the new list (cloud pull). */
  replaceAll: (words: Word[]) => Promise<void>;
  setLoaded: (v: boolean) => void;
}

export const useWordsStore = create<WordsState>((set) => ({
  words: [],
  loaded: false,
  setWords: (words) => set({ words, loaded: true }),
  addWord: async (w) => {
    const row: WordRow = {
      ...withCanonicalWordId(w),
      userId: useAuth.getState().username,
    };
    await dbPut(row);
  },
  addWords: async (words) => {
    const userId = useAuth.getState().username;
    if (!userId || words.length === 0) return;
    const rows: WordRow[] = words.map((w) => ({
      ...withCanonicalWordId(w),
      userId,
    }));
    await db.words.bulkPut(rows);
  },
  /** Bulk overwrite existing rows (same ids). */
  updateWords: async (words) => {
    const userId = useAuth.getState().username;
    if (!userId || words.length === 0) return;
    const rows: WordRow[] = words.map((w) => ({
      ...withCanonicalWordId(w),
      userId,
    }));
    await db.words.bulkPut(rows);
  },
  updateWord: async (w) => {
    const row: WordRow = {
      ...withCanonicalWordId(w),
      userId: useAuth.getState().username,
    };
    await dbPut(row);
  },
  removeWord: async (id) => {
    await dbDelete(id);
  },
  clearForUser: async (userId) => {
    await dbClearForUser(userId);
    set({ words: [] });
  },
  replaceAll: async (words) => {
    const userId = useAuth.getState().username;
    if (!userId) return;
    await dbClearForUser(userId);
    const rows: WordRow[] = words.map((w) => ({
      ...withCanonicalWordId(w),
      userId,
    }));
    if (rows.length > 0) {
      await db.words.bulkPut(rows);
    }
    set({ words, loaded: true });
  },
  setLoaded: (v) => set({ loaded: v }),
}));

export function useUserWords(): Word[] {
  const username = useAuth((s) => s.username);
  /** Gate liveQuery until one-time id migration finishes (must not write inside liveQuery). */
  const [idMigrationReady, setIdMigrationReady] = useState(false);

  useEffect(() => {
    if (!username) {
      setIdMigrationReady(false);
      return;
    }
    let cancelled = false;
    setIdMigrationReady(false);
    void migrateUserWordIdsIfNeeded(username).finally(() => {
      if (!cancelled) setIdMigrationReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const rows = useLiveQuery(
    async () => {
      if (!username || !idMigrationReady) return [];
      return db.words.where('userId').equals(username).toArray();
    },
    [username, idMigrationReady],
    []
  );
  return (rows || []) as Word[];
}

export function makeNewWord(input: Partial<Word> & { word: string; translation?: string }): Word {
  const { phoneticUs, phoneticUk } = migratePhoneticFields(input);
  const word = input.word.trim();
  const id = wordToId(word);
  return {
    id,
    word,
    translation: (input.translation || '').trim(),
    phoneticUs,
    phoneticUk,
    partOfSpeech: input.partOfSpeech || '',
    mnemonic: input.mnemonic || '',
    category: normalizeCategories(input.category),
    synonyms: Array.isArray(input.synonyms) ? input.synonyms : [],
    ...(input.synonymDiff ? { synonymDiff: input.synonymDiff } : {}),
    similars: Array.isArray(input.similars) ? input.similars : [],
    derivatives: Array.isArray(input.derivatives) ? input.derivatives : [],
    collocations: Array.isArray(input.collocations) ? input.collocations : [],
    dictCollocations: Array.isArray(input.dictCollocations)
      ? input.dictCollocations
      : [],
    examples: input.examples || [],
    crossedOut: input.crossedOut ?? false,
    starred: input.starred ?? false,
    ease: input.ease ?? 2.5,
    interval: input.interval ?? 0,
    streak: input.streak ?? 0,
    nextReview: input.nextReview ?? Date.now(),
    totalReviews: input.totalReviews ?? 0,
    correctReviews: input.correctReviews ?? 0,
    createdAt: input.createdAt ?? Date.now(),
  };
}
