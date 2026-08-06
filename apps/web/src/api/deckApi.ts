/**
 * Chunks / Frames content API (progress via srsApi).
 */
import type { Settings } from '@/types/settings';
import type { Chunk } from '@/types/chunk';
import type { Frame } from '@/types/frame';

export class DeckApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getBase(settings: Settings): string {
  return (settings.workerUrl || '').replace(/\/$/, '');
}

function authHeaders(settings: Settings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.syncToken) h.Authorization = `Bearer ${settings.syncToken}`;
  return h;
}

async function readJson(resp: Response): Promise<Record<string, unknown>> {
  try {
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseChunk(raw: unknown): Chunk | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '').trim();
  const phrase = String(o.phrase || '').trim();
  if (!id || !phrase) return null;
  return {
    id,
    phrase,
    phraseKey: String(o.phraseKey || o.phrase_key || phrase.toLowerCase()),
    gloss: String(o.gloss || ''),
    kind: (o.kind as Chunk['kind']) || 'collocation',
    tags: Array.isArray(o.tags) ? (o.tags as string[]) : [],
    anchorWordId: o.anchorWordId || o.anchor_word_id
      ? String(o.anchorWordId || o.anchor_word_id)
      : undefined,
    source: (o.source as Chunk['source']) || 'manual',
    exampleEn: String(o.exampleEn || o.example_en || ''),
    exampleZh: String(o.exampleZh || o.example_zh || ''),
    createdAt: Number(o.createdAt || Date.now()),
    updatedAt: Number(o.updatedAt || Date.now()),
  };
}

function parseFrame(raw: unknown): Frame | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '').trim();
  const title = String(o.title || '').trim();
  if (!id || !title) return null;
  return {
    id,
    title,
    frameKey: String(o.frameKey || o.frame_key || title.toLowerCase()),
    skeleton: String(o.skeleton || ''),
    slots: Array.isArray(o.slots) ? (o.slots as Frame['slots']) : [],
    glossZh: String(o.glossZh || o.gloss_zh || ''),
    anchorWordIds: Array.isArray(o.anchorWordIds || o.anchor_word_ids)
      ? ((o.anchorWordIds || o.anchor_word_ids) as string[])
      : [],
    exampleFilled: String(o.exampleFilled || o.example_filled || ''),
    packId: String(o.packId || o.pack_id || ''),
    source: (o.source as Frame['source']) || 'manual',
    createdAt: Number(o.createdAt || Date.now()),
    updatedAt: Number(o.updatedAt || Date.now()),
  };
}

export function chunkToApiBody(c: Chunk): Record<string, unknown> {
  return {
    id: c.id,
    phrase: c.phrase,
    phraseKey: c.phraseKey,
    gloss: c.gloss,
    kind: c.kind || 'collocation',
    tags: c.tags || [],
    anchorWordId: c.anchorWordId || null,
    source: c.source,
    exampleEn: c.exampleEn || '',
    exampleZh: c.exampleZh || '',
    createdAt: c.createdAt,
    updatedAt: c.updatedAt || Date.now(),
  };
}

export function frameToApiBody(f: Frame): Record<string, unknown> {
  return {
    id: f.id,
    title: f.title,
    frameKey: f.frameKey,
    skeleton: f.skeleton,
    slots: f.slots || [],
    glossZh: f.glossZh,
    anchorWordIds: f.anchorWordIds || [],
    exampleFilled: f.exampleFilled || '',
    packId: f.packId || '',
    source: f.source,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt || Date.now(),
  };
}

async function fetchPaged<T>(
  settings: Settings,
  path: string,
  listKey: string,
  parse: (raw: unknown) => T | null,
  sinceMs?: number
): Promise<{ items: T[]; maxUpdatedAt: number }> {
  if (!settings.syncToken) return { items: [], maxUpdatedAt: 0 };
  const items: T[] = [];
  let maxUpdatedAt = 0;
  let cursor = '';
  for (;;) {
    const params = new URLSearchParams();
    params.set('limit', '2000');
    if (sinceMs && sinceMs > 0) params.set('since', String(sinceMs));
    if (cursor) params.set('cursor', cursor);
    const resp = await fetch(getBase(settings) + path + '?' + params.toString(), {
      headers: authHeaders(settings),
    });
    const data = await readJson(resp);
    if (!resp.ok) {
      throw new DeckApiError(String(data.error || `拉取失败 ${resp.status}`), resp.status);
    }
    const list = Array.isArray(data[listKey]) ? (data[listKey] as unknown[]) : [];
    for (const raw of list) {
      const item = parse(raw);
      if (item) items.push(item);
    }
    maxUpdatedAt = Math.max(maxUpdatedAt, Number(data.maxUpdatedAt || 0));
    const next = typeof data.nextCursor === 'string' ? data.nextCursor : '';
    if (!next || list.length === 0) break;
    cursor = next;
  }
  return { items, maxUpdatedAt: maxUpdatedAt || Date.now() };
}

export function fetchChunksSince(settings: Settings, sinceMs?: number) {
  return fetchPaged(settings, '/api/chunks', 'chunks', parseChunk, sinceMs).then((r) => ({
    chunks: r.items,
    maxUpdatedAt: r.maxUpdatedAt,
  }));
}

export function fetchFramesSince(settings: Settings, sinceMs?: number) {
  return fetchPaged(settings, '/api/frames', 'frames', parseFrame, sinceMs).then((r) => ({
    frames: r.items,
    maxUpdatedAt: r.maxUpdatedAt,
  }));
}

export async function putChunk(settings: Settings, chunk: Chunk): Promise<Chunk> {
  const resp = await fetch(
    getBase(settings) + '/api/chunks/' + encodeURIComponent(chunk.id),
    {
      method: 'PUT',
      headers: authHeaders(settings),
      body: JSON.stringify(chunkToApiBody(chunk)),
    }
  );
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new DeckApiError(String(data.error || `保存失败 ${resp.status}`), resp.status);
  }
  return parseChunk(data.chunk) || chunk;
}

export async function deleteChunkRemote(settings: Settings, chunkId: string): Promise<void> {
  const resp = await fetch(
    getBase(settings) + '/api/chunks/' + encodeURIComponent(chunkId),
    { method: 'DELETE', headers: authHeaders(settings) }
  );
  if (resp.status === 404) return;
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new DeckApiError(String(data.error || `删除失败 ${resp.status}`), resp.status);
  }
}

export async function putFrame(settings: Settings, frame: Frame): Promise<Frame> {
  const resp = await fetch(
    getBase(settings) + '/api/frames/' + encodeURIComponent(frame.id),
    {
      method: 'PUT',
      headers: authHeaders(settings),
      body: JSON.stringify(frameToApiBody(frame)),
    }
  );
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new DeckApiError(String(data.error || `保存失败 ${resp.status}`), resp.status);
  }
  return parseFrame(data.frame) || frame;
}

export async function deleteFrameRemote(settings: Settings, frameId: string): Promise<void> {
  const resp = await fetch(
    getBase(settings) + '/api/frames/' + encodeURIComponent(frameId),
    { method: 'DELETE', headers: authHeaders(settings) }
  );
  if (resp.status === 404) return;
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new DeckApiError(String(data.error || `删除失败 ${resp.status}`), resp.status);
  }
}

export async function batchPutChunks(settings: Settings, chunks: Chunk[]): Promise<number> {
  if (!settings.syncToken || !chunks.length) return 0;
  const resp = await fetch(getBase(settings) + '/api/chunks/batch', {
    method: 'POST',
    headers: authHeaders(settings),
    body: JSON.stringify({ chunks: chunks.map(chunkToApiBody) }),
  });
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new DeckApiError(String(data.error || '批量上传失败'), resp.status);
  }
  return Number(data.count || chunks.length);
}

export async function batchPutFrames(settings: Settings, frames: Frame[]): Promise<number> {
  if (!settings.syncToken || !frames.length) return 0;
  const resp = await fetch(getBase(settings) + '/api/frames/batch', {
    method: 'POST',
    headers: authHeaders(settings),
    body: JSON.stringify({ frames: frames.map(frameToApiBody) }),
  });
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new DeckApiError(String(data.error || '批量上传失败'), resp.status);
  }
  return Number(data.count || frames.length);
}
