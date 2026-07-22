/**
 * Words store — wraps Dexie + provides imperative helpers.
 * Words are scoped to current user; switching users clears the in-memory list.
 */
import { create } from 'zustand';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, dbClearForUser, dbPut, dbDelete, newId, type WordRow } from '@/db/ieltsDb';
import type { Word } from '@/types/word';
import { useAuth } from './useAuth';

interface WordsState {
  words: Word[];
  loaded: boolean;
  setWords: (w: Word[]) => void;
  addWord: (w: Word) => Promise<void>;
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
    const row: WordRow = { ...w, userId: useAuth.getState().username };
    await dbPut(row);
  },
  updateWord: async (w) => {
    const row: WordRow = { ...w, userId: useAuth.getState().username };
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
    const rows: WordRow[] = words.map((w) => ({ ...w, userId }));
    if (rows.length > 0) {
      await db.words.bulkPut(rows);
    }
    set({ words, loaded: true });
  },
  setLoaded: (v) => set({ loaded: v }),
}));

export function useUserWords(): Word[] {
  const username = useAuth((s) => s.username);
  const rows = useLiveQuery(
    async () => {
      if (!username) return [];
      return db.words.where('userId').equals(username).toArray();
    },
    [username],
    []
  );
  return (rows || []) as Word[];
}

export function makeNewWord(input: Partial<Word> & { word: string; translation?: string }): Word {
  return {
    id: input.id || newId(),
    word: input.word.trim(),
    translation: (input.translation || '').trim(),
    phonetic: input.phonetic || '',
    partOfSpeech: input.partOfSpeech || '',
    mnemonic: input.mnemonic || '',
    examples: input.examples || [],
    crossedOut: input.crossedOut ?? false,
    ease: input.ease ?? 2.5,
    interval: input.interval ?? 0,
    streak: input.streak ?? 0,
    nextReview: input.nextReview ?? Date.now(),
    totalReviews: input.totalReviews ?? 0,
    correctReviews: input.correctReviews ?? 0,
    createdAt: input.createdAt ?? Date.now(),
  };
}
