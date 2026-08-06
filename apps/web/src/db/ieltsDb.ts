/**
 * Dexie schema for local storage.
 * v1: words
 * v2: chunks + frames + srsProgress (unified SRS for chunk/frame; words still embed SRS)
 */

import Dexie, { type Table } from 'dexie';
import type { Word } from '@/types/word';
import type { Chunk } from '@/types/chunk';
import type { Frame } from '@/types/frame';
import type { SrsProgress, SrsTargetType } from '@/types/srsProgress';
import { srsLocalId } from '@/types/srsProgress';

export interface WordRow extends Word {
  userId: string;
}

export interface ChunkRow extends Chunk {
  userId: string;
}

export interface FrameRow extends Frame {
  userId: string;
}

export interface SrsProgressRow extends SrsProgress {
  /** `${targetType}:${targetId}` */
  id: string;
  userId: string;
}

class IeltsDb extends Dexie {
  words!: Table<WordRow, string>;
  chunks!: Table<ChunkRow, string>;
  frames!: Table<FrameRow, string>;
  srsProgress!: Table<SrsProgressRow, string>;

  constructor() {
    super('ielts-vocab');
    this.version(1).stores({
      words: 'id, userId, word',
    });
    this.version(2).stores({
      words: 'id, userId, word',
      chunks: 'id, userId, phraseKey, [userId+phraseKey], anchorWordId, updatedAt',
      frames: 'id, userId, frameKey, [userId+frameKey], updatedAt',
      srsProgress: 'id, userId, targetType, targetId, nextReview, updatedAt, [userId+targetType]',
    });
  }
}

export const db = new IeltsDb();

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

export function makeDefaultSrs(
  targetType: SrsTargetType,
  targetId: string,
  now = Date.now()
): SrsProgress {
  return {
    targetType,
    targetId,
    ease: 2.5,
    interval: 0,
    streak: 0,
    nextReview: now,
    totalReviews: 0,
    correctReviews: 0,
    starred: false,
    crossedOut: false,
    updatedAt: now,
  };
}

export async function upsertLocalSrs(
  userId: string,
  progress: SrsProgress
): Promise<void> {
  const row: SrsProgressRow = {
    ...progress,
    id: srsLocalId(progress.targetType, progress.targetId),
    userId,
  };
  await db.srsProgress.put(row);
}

export async function getLocalSrs(
  userId: string,
  targetType: SrsTargetType,
  targetId: string
): Promise<SrsProgress | null> {
  const row = await db.srsProgress.get(srsLocalId(targetType, targetId));
  if (!row || row.userId !== userId) return null;
  const { id: _id, userId: _u, ...rest } = row;
  return rest;
}

export async function deleteLocalSrs(
  userId: string,
  targetType: SrsTargetType,
  targetId: string
): Promise<void> {
  const id = srsLocalId(targetType, targetId);
  const row = await db.srsProgress.get(id);
  if (row?.userId === userId) await db.srsProgress.delete(id);
}
