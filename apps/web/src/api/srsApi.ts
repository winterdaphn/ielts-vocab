/**
 * Unified SRS progress API client (JWT Bearer).
 */
import type { Settings } from '@/types/settings';
import type { SrsProgress, SrsTargetType } from '@/types/srsProgress';

export class SrsApiError extends Error {
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

export function parseSrsItem(raw: unknown): SrsProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const targetType = String(o.targetType || o.target_type || '').trim() as SrsTargetType;
  const targetId = String(o.targetId || o.target_id || '').trim();
  if (!targetType || !targetId) return null;
  if (targetType !== 'word' && targetType !== 'chunk' && targetType !== 'frame') {
    return null;
  }
  return {
    targetType,
    targetId,
    ease: Number(o.ease ?? 2.5),
    interval: Number(o.interval ?? o.interval_days ?? 0),
    streak: Number(o.streak ?? 0),
    nextReview: Number(o.nextReview ?? o.next_review ?? Date.now()),
    totalReviews: Number(o.totalReviews ?? o.total_reviews ?? 0),
    correctReviews: Number(o.correctReviews ?? o.correct_reviews ?? 0),
    starred: !!o.starred,
    crossedOut: !!(o.crossedOut ?? o.crossed_out),
    updatedAt: Number(o.updatedAt ?? o.updated_at ?? Date.now()),
  };
}

const PULL_PAGE_SIZE = 2000;

async function fetchSrsPage(
  settings: Settings,
  sinceMs: number | undefined,
  cursor: string,
  targetType?: SrsTargetType
): Promise<{
  page: SrsProgress[];
  maxUpdatedAt: number;
  nextCursor: string;
}> {
  const params = new URLSearchParams();
  params.set('limit', String(PULL_PAGE_SIZE));
  if (sinceMs && sinceMs > 0) params.set('since', String(sinceMs));
  if (cursor) params.set('cursor', cursor);
  if (targetType) params.set('targetType', targetType);

  const resp = await fetch(getBase(settings) + '/api/srs?' + params.toString(), {
    headers: authHeaders(settings),
  });
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new SrsApiError(String(data.error || `SRS 拉取失败 ${resp.status}`), resp.status);
  }
  const list = Array.isArray(data.items) ? data.items : [];
  const page = list.map(parseSrsItem).filter(Boolean) as SrsProgress[];
  const next = typeof data.nextCursor === 'string' ? data.nextCursor : '';
  return {
    page,
    maxUpdatedAt: Number(data.maxUpdatedAt || 0),
    nextCursor: next && page.length > 0 ? next : '',
  };
}

export async function fetchSrsSince(
  settings: Settings,
  sinceMs?: number,
  targetType?: SrsTargetType
): Promise<{ items: SrsProgress[]; maxUpdatedAt: number }> {
  if (!settings.syncToken) return { items: [], maxUpdatedAt: 0 };

  const items: SrsProgress[] = [];
  let maxUpdatedAt = 0;
  let cursor = '';

  for (;;) {
    const batch = await fetchSrsPage(settings, sinceMs, cursor, targetType);
    maxUpdatedAt = Math.max(maxUpdatedAt, batch.maxUpdatedAt);
    items.push(...batch.page);
    if (!batch.nextCursor) break;
    cursor = batch.nextCursor;
  }

  return { items, maxUpdatedAt: maxUpdatedAt || Date.now() };
}

export async function patchSrsFields(
  settings: Settings,
  targetType: SrsTargetType,
  targetId: string,
  fields: Record<string, unknown>
): Promise<SrsProgress | null> {
  const resp = await fetch(
    getBase(settings) +
      '/api/srs/' +
      encodeURIComponent(targetType) +
      '/' +
      encodeURIComponent(targetId),
    {
      method: 'PATCH',
      headers: authHeaders(settings),
      body: JSON.stringify({
        ...fields,
        updatedAt: Number(fields.updatedAt ?? Date.now()),
      }),
    }
  );
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new SrsApiError(String(data.error || `SRS 更新失败 ${resp.status}`), resp.status);
  }
  return parseSrsItem(data.item);
}

export async function putSrs(
  settings: Settings,
  item: SrsProgress
): Promise<SrsProgress> {
  const resp = await fetch(
    getBase(settings) +
      '/api/srs/' +
      encodeURIComponent(item.targetType) +
      '/' +
      encodeURIComponent(item.targetId),
    {
      method: 'PUT',
      headers: authHeaders(settings),
      body: JSON.stringify({
        ease: item.ease,
        interval: item.interval,
        streak: item.streak,
        nextReview: item.nextReview,
        totalReviews: item.totalReviews,
        correctReviews: item.correctReviews,
        starred: !!item.starred,
        crossedOut: !!item.crossedOut,
        updatedAt: item.updatedAt || Date.now(),
      }),
    }
  );
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new SrsApiError(String(data.error || `SRS 保存失败 ${resp.status}`), resp.status);
  }
  return parseSrsItem(data.item) || item;
}

/** Apply remote SRS onto a local Word (progress fields only). */
export function applySrsToWord<T extends {
  ease: number;
  interval: number;
  streak: number;
  nextReview: number;
  totalReviews: number;
  correctReviews: number;
  crossedOut: boolean;
  starred?: boolean;
  progressUpdatedAt?: number;
}>(word: T, srs: SrsProgress): T {
  return {
    ...word,
    ease: srs.ease,
    interval: srs.interval,
    streak: srs.streak,
    nextReview: srs.nextReview,
    totalReviews: srs.totalReviews,
    correctReviews: srs.correctReviews,
    crossedOut: !!srs.crossedOut,
    starred: !!srs.starred,
    progressUpdatedAt: srs.updatedAt,
  };
}
