/**
 * Dexie schema for local word storage.
 * Per-user, but we keep a single DB and use indexed `userId` to scope queries.
 * This way the same browser can host multiple users without DB version churn.
 */

import Dexie, { type Table } from 'dexie';
import type { Word } from '@/types/word';

export interface WordRow extends Word {
  userId: string;  // username (auth)
}

class IeltsDb extends Dexie {
  words!: Table<WordRow, string>;

  constructor() {
    super('ielts-vocab');
    this.version(1).stores({
      // primary key: canonical lemma id; indexes: userId, word (display spelling)
      words: 'id, userId, word',
    });
  }
}

export const db = new IeltsDb();

/** Generate an ID with fallback for older browsers */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

export async function dbPut(word: WordRow): Promise<void> {
  await db.words.put(word);
}

export async function dbDelete(id: string): Promise<void> {
  await db.words.delete(id);
}

export async function dbClearForUser(userId: string): Promise<void> {
  await db.words.where('userId').equals(userId).delete();
}
