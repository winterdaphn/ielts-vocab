/**
 * Chunks (搭配本) content store + Dexie; SRS in srsProgress table.
 */
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { create } from 'zustand';
import {
  db,
  deleteLocalSrs,
  makeDefaultSrs,
  newId,
  upsertLocalSrs,
  type ChunkRow,
} from '@/db/ieltsDb';
import type { Chunk, ChunkSource, ChunkWithProgress } from '@/types/chunk';
import { normalizePhraseKey } from '@/types/chunk';
import type { SrsProgress } from '@/types/srsProgress';
import { srsLocalId } from '@/types/srsProgress';
import { useAuth } from '@/store/useAuth';
import { enqueueChunkDelete, enqueueChunkPut } from '@/api/deckSync';
import { enqueueSrsProgress } from '@/api/deckSync';

interface ChunksState {
  addFromCollocation: (opts: {
    phrase: string;
    gloss: string;
    anchorWordId?: string;
    source: ChunkSource;
    exampleEn?: string;
    exampleZh?: string;
    explanation?: string;
  }) => Promise<{ chunk: Chunk; existed: boolean }>;
  upsertChunk: (chunk: Chunk) => Promise<void>;
  updateChunk: (chunk: Chunk) => Promise<void>;
  removeChunk: (id: string) => Promise<void>;
  updateProgress: (progress: SrsProgress) => Promise<void>;
  findByPhraseKey: (phraseKey: string) => Promise<Chunk | null>;
}

export const useChunksStore = create<ChunksState>(() => ({
  addFromCollocation: async ({
    phrase,
    gloss,
    anchorWordId,
    source,
    exampleEn,
    exampleZh,
    explanation,
  }) => {
    const userId = useAuth.getState().username;
    if (!userId) throw new Error('not_logged_in');
    const phraseKey = normalizePhraseKey(phrase);
    const existing = await db.chunks
      .where('[userId+phraseKey]')
      .equals([userId, phraseKey])
      .first();
    if (existing) {
      return { chunk: existing as Chunk, existed: true };
    }
    const now = Date.now();
    const chunk: Chunk = {
      id: newId(),
      phrase: phrase.trim(),
      phraseKey,
      gloss: (gloss || '').trim(),
      kind: 'collocation',
      tags: [],
      anchorWordId,
      source,
      exampleEn: exampleEn || '',
      exampleZh: exampleZh || '',
      explanation: explanation || '',
      createdAt: now,
      updatedAt: now,
    };
    const row: ChunkRow = { ...chunk, userId };
    await db.chunks.put(row);
    await upsertLocalSrs(userId, makeDefaultSrs('chunk', chunk.id, now));
    enqueueChunkPut(chunk);
    enqueueSrsProgress(makeDefaultSrs('chunk', chunk.id, now));
    return { chunk, existed: false };
  },

  upsertChunk: async (chunk) => {
    const userId = useAuth.getState().username;
    if (!userId) return;
    const now = Date.now();
    const next = { ...chunk, updatedAt: now };
    await db.chunks.put({ ...next, userId });
    const srs = await db.srsProgress.get(srsLocalId('chunk', chunk.id));
    if (!srs) {
      await upsertLocalSrs(userId, makeDefaultSrs('chunk', chunk.id, now));
      enqueueSrsProgress(makeDefaultSrs('chunk', chunk.id, now));
    }
    enqueueChunkPut(next);
  },

  updateChunk: async (chunk) => {
    const userId = useAuth.getState().username;
    if (!userId) return;
    const next = { ...chunk, updatedAt: Date.now() };
    await db.chunks.put({ ...next, userId });
    enqueueChunkPut(next);
  },

  removeChunk: async (id) => {
    const userId = useAuth.getState().username;
    if (!userId) return;
    await db.chunks.delete(id);
    await deleteLocalSrs(userId, 'chunk', id);
    enqueueChunkDelete(id);
  },

  updateProgress: async (progress) => {
    const userId = useAuth.getState().username;
    if (!userId) return;
    const next = { ...progress, updatedAt: Date.now() };
    await upsertLocalSrs(userId, next);
    enqueueSrsProgress(next);
  },

  findByPhraseKey: async (phraseKey) => {
    const userId = useAuth.getState().username;
    if (!userId) return null;
    const row = await db.chunks.where('[userId+phraseKey]').equals([userId, phraseKey]).first();
    return (row as Chunk) || null;
  },
}));

export function useUserChunks(): Chunk[] {
  const username = useAuth((s) => s.username);
  const rows = useLiveQuery(
    async () => {
      if (!username) return [];
      return db.chunks.where('userId').equals(username).toArray();
    },
    [username],
    []
  );
  return (rows || []) as Chunk[];
}

export function useUserChunkProgress(): SrsProgress[] {
  const username = useAuth((s) => s.username);
  const rows = useLiveQuery(
    async () => {
      if (!username) return [];
      return db.srsProgress
        .where('[userId+targetType]')
        .equals([username, 'chunk'])
        .toArray();
    },
    [username],
    []
  );
  return (rows || []).map(({ id: _i, userId: _u, ...rest }) => rest as SrsProgress);
}

export function useChunksWithProgress(): ChunkWithProgress[] {
  const chunks = useUserChunks();
  const progressList = useUserChunkProgress();
  return useMemo(() => {
    const map = new Map(progressList.map((p) => [p.targetId, p]));
    return chunks.map((c) => ({
      ...c,
      progress: map.get(c.id) || makeDefaultSrs('chunk', c.id),
    }));
  }, [chunks, progressList]);
}

export function useChunkDueStats(now = Date.now()) {
  const items = useChunksWithProgress();
  return useMemo(() => {
    const active = items.filter((c) => !c.progress.crossedOut);
    const due = active.filter(
      (c) => c.progress.totalReviews > 0 && c.progress.nextReview <= now
    ).length;
    const fresh = active.filter((c) => c.progress.totalReviews === 0).length;
    return { total: active.length, due, fresh };
  }, [items, now]);
}
