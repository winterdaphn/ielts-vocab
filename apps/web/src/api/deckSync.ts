/**
 * Debounced sync queue for chunks / frames content + their SRS rows.
 */
import type { Chunk } from '@/types/chunk';
import type { Frame } from '@/types/frame';
import type { SrsProgress } from '@/types/srsProgress';
import { useSettings } from '@/store/useSettings';
import { useAuth } from '@/store/useAuth';
import {
  deleteChunkRemote,
  deleteFrameRemote,
  fetchChunksSince,
  fetchFramesSince,
  putChunk,
  putFrame,
} from '@/api/deckApi';
import { patchSrsFields, putSrs } from '@/api/srsApi';
import { db } from '@/db/ieltsDb';

type DeckKind = 'chunk-put' | 'chunk-del' | 'frame-put' | 'frame-del' | 'srs';

interface DeckQueueItem {
  kind: DeckKind;
  chunk?: Chunk;
  frame?: Frame;
  chunkId?: string;
  frameId?: string;
  srs?: SrsProgress;
}

const queue = new Map<string, DeckQueueItem>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function settings() {
  return useSettings.getState();
}

function scheduleFlush() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void flushDeckSyncQueue();
  }, 1000);
}

export function enqueueChunkPut(chunk: Chunk) {
  const s = settings();
  if (!s.syncToken || !s.autoSync) return;
  queue.set(`chunk:${chunk.id}`, { kind: 'chunk-put', chunk });
  scheduleFlush();
}

export function enqueueChunkDelete(chunkId: string) {
  const s = settings();
  if (!s.syncToken || !s.autoSync) return;
  queue.set(`chunk:${chunkId}`, { kind: 'chunk-del', chunkId });
  scheduleFlush();
}

export function enqueueFramePut(frame: Frame) {
  const s = settings();
  if (!s.syncToken || !s.autoSync) return;
  queue.set(`frame:${frame.id}`, { kind: 'frame-put', frame });
  scheduleFlush();
}

export function enqueueFrameDelete(frameId: string) {
  const s = settings();
  if (!s.syncToken || !s.autoSync) return;
  queue.set(`frame:${frameId}`, { kind: 'frame-del', frameId });
  scheduleFlush();
}

export function enqueueSrsProgress(srs: SrsProgress) {
  const s = settings();
  if (!s.syncToken || !s.autoSync) return;
  queue.set(`srs:${srs.targetType}:${srs.targetId}`, { kind: 'srs', srs });
  scheduleFlush();
}

export async function flushDeckSyncQueue(): Promise<void> {
  if (flushing) return;
  const s = settings();
  if (!s.syncToken || queue.size === 0) return;
  flushing = true;
  const items = [...queue.values()];
  queue.clear();
  try {
    for (const item of items) {
      if (item.kind === 'chunk-put' && item.chunk) await putChunk(s, item.chunk);
      else if (item.kind === 'chunk-del' && item.chunkId) {
        await deleteChunkRemote(s, item.chunkId);
      } else if (item.kind === 'frame-put' && item.frame) await putFrame(s, item.frame);
      else if (item.kind === 'frame-del' && item.frameId) {
        await deleteFrameRemote(s, item.frameId);
      } else if (item.kind === 'srs' && item.srs) {
        try {
          await patchSrsFields(s, item.srs.targetType, item.srs.targetId, {
            ease: item.srs.ease,
            interval: item.srs.interval,
            streak: item.srs.streak,
            nextReview: item.srs.nextReview,
            totalReviews: item.srs.totalReviews,
            correctReviews: item.srs.correctReviews,
            starred: !!item.srs.starred,
            crossedOut: !!item.srs.crossedOut,
          });
        } catch {
          await putSrs(s, item.srs);
        }
      }
    }
  } catch (e) {
    for (const item of items) {
      const key =
        item.kind === 'srs' && item.srs
          ? `srs:${item.srs.targetType}:${item.srs.targetId}`
          : item.kind.startsWith('chunk')
            ? `chunk:${item.chunk?.id || item.chunkId}`
            : `frame:${item.frame?.id || item.frameId}`;
      if (key && !queue.has(key)) queue.set(key, item);
    }
    console.warn('[deck-sync] flush failed', e);
    scheduleFlush();
  } finally {
    flushing = false;
  }
}

/** Pull chunks / frames content into Dexie (SRS pulled with words sync). */
export async function pullDeckContentIncremental(): Promise<{ merged: number }> {
  const s = settings();
  if (!s.syncToken) return { merged: 0 };
  const userId = useAuth.getState().username;
  if (!userId) return { merged: 0 };

  let merged = 0;
  const chunkSince = s.lastChunkSyncAt > 0 ? s.lastChunkSyncAt : undefined;
  const frameSince = s.lastFrameSyncAt > 0 ? s.lastFrameSyncAt : undefined;

  const { chunks, maxUpdatedAt: chunkMax } = await fetchChunksSince(s, chunkSince);
  const { frames, maxUpdatedAt: frameMax } = await fetchFramesSince(s, frameSince);

  for (const c of chunks) {
    const local = await db.chunks.get(c.id);
    const lUp = Number(local?.updatedAt || 0);
    const rUp = Number(c.updatedAt || 0);
    if (!local || rUp >= lUp) {
      await db.chunks.put({ ...c, userId });
      merged++;
    }
  }
  for (const f of frames) {
    const local = await db.frames.get(f.id);
    const lUp = Number(local?.updatedAt || 0);
    const rUp = Number(f.updatedAt || 0);
    if (!local || rUp >= lUp) {
      await db.frames.put({ ...f, userId });
      merged++;
    }
  }

  useSettings.getState().update({
    lastChunkSyncAt: Math.max(chunkMax, s.lastChunkSyncAt, Date.now()),
    lastFrameSyncAt: Math.max(frameMax, s.lastFrameSyncAt, Date.now()),
  });

  return { merged };
}
