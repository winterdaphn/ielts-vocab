/**
 * Frames (句型模板) content store — Phase 2.
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
  type FrameRow,
} from '@/db/ieltsDb';
import type { Frame, FrameSlot, FrameWithProgress } from '@/types/frame';
import { normalizeFrameKey } from '@/types/frame';
import type { SrsProgress } from '@/types/srsProgress';
import { srsLocalId } from '@/types/srsProgress';
import { useAuth } from '@/store/useAuth';
import { enqueueFrameDelete, enqueueFramePut, enqueueSrsProgress } from '@/api/deckSync';
import { FRAME_PACK, packItemToFrame, type FramePackItem } from '@/data/framePack';

interface FramesState {
  addFromPack: (item: FramePackItem) => Promise<{ frame: Frame; existed: boolean }>;
  addManual: (opts: {
    title: string;
    skeleton: string;
    glossZh: string;
    exampleFilled?: string;
    slots?: FrameSlot[];
  }) => Promise<{ frame: Frame; existed: boolean }>;
  upsertFrame: (frame: Frame) => Promise<void>;
  removeFrame: (id: string) => Promise<void>;
  updateProgress: (progress: SrsProgress) => Promise<void>;
  findByFrameKey: (frameKey: string) => Promise<Frame | null>;
}

export const useFramesStore = create<FramesState>(() => ({
  addFromPack: async (item) => {
    const userId = useAuth.getState().username;
    if (!userId) throw new Error('not_logged_in');
    const frameKey = normalizeFrameKey(item.skeleton);
    const existing = await db.frames.where('[userId+frameKey]').equals([userId, frameKey]).first();
    if (existing) {
      return { frame: existing as Frame, existed: true };
    }
    const now = Date.now();
    const frame: Frame = {
      ...packItemToFrame(item, newId()),
      createdAt: now,
      updatedAt: now,
    };
    await db.frames.put({ ...frame, userId });
    await upsertLocalSrs(userId, makeDefaultSrs('frame', frame.id, now));
    enqueueFramePut(frame);
    enqueueSrsProgress(makeDefaultSrs('frame', frame.id, now));
    return { frame, existed: false };
  },

  addManual: async ({ title, skeleton, glossZh, exampleFilled, slots }) => {
    const userId = useAuth.getState().username;
    if (!userId) throw new Error('not_logged_in');
    const sk = skeleton.trim();
    const frameKey = normalizeFrameKey(sk);
    const existing = await db.frames.where('[userId+frameKey]').equals([userId, frameKey]).first();
    if (existing) {
      return { frame: existing as Frame, existed: true };
    }
    const now = Date.now();
    const frame: Frame = {
      id: newId(),
      title: title.trim() || sk.slice(0, 48),
      frameKey,
      skeleton: sk,
      slots: slots || [],
      glossZh: (glossZh || '').trim(),
      exampleFilled: (exampleFilled || '').trim(),
      source: 'manual',
      createdAt: now,
      updatedAt: now,
    };
    await db.frames.put({ ...frame, userId });
    await upsertLocalSrs(userId, makeDefaultSrs('frame', frame.id, now));
    enqueueFramePut(frame);
    enqueueSrsProgress(makeDefaultSrs('frame', frame.id, now));
    return { frame, existed: false };
  },

  upsertFrame: async (frame) => {
    const userId = useAuth.getState().username;
    if (!userId) return;
    const now = Date.now();
    const next = { ...frame, updatedAt: now };
    await db.frames.put({ ...next, userId } as FrameRow);
    const srs = await db.srsProgress.get(srsLocalId('frame', frame.id));
    if (!srs) {
      await upsertLocalSrs(userId, makeDefaultSrs('frame', frame.id, now));
      enqueueSrsProgress(makeDefaultSrs('frame', frame.id, now));
    }
    enqueueFramePut(next);
  },

  removeFrame: async (id) => {
    const userId = useAuth.getState().username;
    if (!userId) return;
    await db.frames.delete(id);
    await deleteLocalSrs(userId, 'frame', id);
    enqueueFrameDelete(id);
  },

  updateProgress: async (progress) => {
    const userId = useAuth.getState().username;
    if (!userId) return;
    const next = { ...progress, updatedAt: Date.now() };
    await upsertLocalSrs(userId, next);
    enqueueSrsProgress(next);
  },

  findByFrameKey: async (frameKey) => {
    const userId = useAuth.getState().username;
    if (!userId) return null;
    const row = await db.frames.where('[userId+frameKey]').equals([userId, frameKey]).first();
    return (row as Frame) || null;
  },
}));

export function useUserFrames(): Frame[] {
  const username = useAuth((s) => s.username);
  const rows = useLiveQuery(
    async () => {
      if (!username) return [];
      return db.frames.where('userId').equals(username).toArray();
    },
    [username],
    []
  );
  return (rows || []) as Frame[];
}

export function useUserFrameProgress(): SrsProgress[] {
  const username = useAuth((s) => s.username);
  const rows = useLiveQuery(
    async () => {
      if (!username) return [];
      return db.srsProgress
        .where('[userId+targetType]')
        .equals([username, 'frame'])
        .toArray();
    },
    [username],
    []
  );
  return (rows || []).map(({ id: _i, userId: _u, ...rest }) => rest as SrsProgress);
}

export function useFramesWithProgress(): FrameWithProgress[] {
  const frames = useUserFrames();
  const progressList = useUserFrameProgress();
  return useMemo(() => {
    const map = new Map(progressList.map((p) => [p.targetId, p]));
    return frames.map((f) => ({
      ...f,
      progress: map.get(f.id) || makeDefaultSrs('frame', f.id),
    }));
  }, [frames, progressList]);
}

export function useFrameDueStats(now = Date.now()) {
  const items = useFramesWithProgress();
  return useMemo(() => {
    const active = items.filter((f) => !f.progress.crossedOut);
    const due = active.filter(
      (f) => f.progress.totalReviews > 0 && f.progress.nextReview <= now
    ).length;
    const fresh = active.filter((f) => f.progress.totalReviews === 0).length;
    return { total: active.length, due, fresh, packSize: FRAME_PACK.length };
  }, [items, now]);
}

export { FRAME_PACK };
