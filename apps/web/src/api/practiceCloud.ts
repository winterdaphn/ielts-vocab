/**
 * Practice session API — one active session per user, items synced per question.
 */
import type { Settings } from '@/types/settings';
import type { WordExample } from '@/types/word';
import type {
  PracticeMode,
  SentenceDifficulty,
  StudyScope,
} from '@/utils/practiceSession';

export class PracticeCloudError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface CloudPracticeItem {
  ordinal: number;
  wordId: string;
  example: WordExample | null;
  attempt: Record<string, unknown> | null;
  wasNew: boolean;
  clientUpdatedAt: number;
}

export interface CloudPracticeSession {
  sessionId: string;
  status: string;
  mode: PracticeMode;
  scope: StudyScope;
  difficulty: SentenceDifficulty;
  idx: number;
  stats: { correct: number; total: number };
  uiState: Record<string, unknown>;
  revision: number;
  clientUpdatedAt: number;
  createdAt: number;
  updatedAt: number;
  items: CloudPracticeItem[];
}

function getBase(settings: Settings): string {
  return (settings.workerUrl || '').replace(/\/$/, '');
}

function headers(settings: Settings): Record<string, string> {
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

function safeJsonBody(payload: unknown): string {
  return JSON.stringify(payload, (_key, value) => {
    if (typeof value === 'bigint') return Number(value);
    if (value instanceof Error) return value.message;
    return value;
  });
}

export type PatchPracticeSessionResult =
  | { sessionId: string; revision: number; gone?: boolean; applied?: boolean }
  | { error: string; status?: number; body?: string };

function parseSession(raw: unknown): CloudPracticeSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const sessionId = String(o.sessionId || '');
  if (!sessionId) return null;
  const itemsRaw = Array.isArray(o.items) ? o.items : [];
  return {
    sessionId,
    status: String(o.status || 'active'),
    mode: String(o.mode || 'cloze') as PracticeMode,
    scope: String(o.scope || 'mixed') as StudyScope,
    difficulty: String(o.difficulty || 'medium') as SentenceDifficulty,
    idx: Number(o.idx) || 0,
    stats: (o.stats as CloudPracticeSession['stats']) || { correct: 0, total: 0 },
    uiState: (o.uiState as Record<string, unknown>) || {},
    revision: Number(o.revision) || 1,
    clientUpdatedAt: Number(o.clientUpdatedAt) || 0,
    createdAt: Number(o.createdAt) || Date.now(),
    updatedAt: Number(o.updatedAt) || Date.now(),
    items: itemsRaw.map((it, ordinal) => {
      const x = it as Record<string, unknown>;
      return {
        ordinal: Number(x.ordinal ?? ordinal),
        wordId: String(x.wordId || ''),
        example: (x.example as WordExample) || null,
        attempt: (x.attempt as Record<string, unknown>) || null,
        wasNew: !!x.wasNew,
        clientUpdatedAt: Number(x.clientUpdatedAt) || 0,
      };
    }),
  };
}

export async function createPracticeSession(
  settings: Settings,
  payload: {
    mode: PracticeMode;
    scope: StudyScope;
    difficulty: SentenceDifficulty;
    wordIds: string[];
    wasNewByWordId?: Record<string, boolean>;
  }
): Promise<CloudPracticeSession> {
  const resp = await fetch(getBase(settings) + '/api/practice/sessions', {
    method: 'POST',
    headers: headers(settings),
    body: JSON.stringify({
      ...payload,
      clientUpdatedAt: Date.now(),
    }),
  });
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new PracticeCloudError(String(data.error || '创建练习失败'), resp.status);
  }
  const session = parseSession(data.session);
  if (!session) throw new PracticeCloudError('invalid_session', 500);
  return session;
}

export async function fetchActivePracticeSession(
  settings: Settings
): Promise<CloudPracticeSession | null> {
  if (!settings.syncToken) return null;
  const resp = await fetch(getBase(settings) + '/api/practice/active', {
    headers: headers(settings),
  });
  const data = await readJson(resp);
  if (!resp.ok) return null;
  return parseSession(data.session);
}

export async function fetchPracticeSession(
  settings: Settings,
  sessionId: string
): Promise<CloudPracticeSession | null> {
  const resp = await fetch(
    getBase(settings) + '/api/practice/sessions/' + encodeURIComponent(sessionId),
    { headers: headers(settings) }
  );
  const data = await readJson(resp);
  if (!resp.ok) return null;
  return parseSession(data.session);
}

export async function checkPracticeSession(
  settings: Settings,
  sessionId: string,
  revision: number
): Promise<{
  match: boolean;
  serverRevision: number | null;
  serverUpdatedAt: number | null;
  gone: boolean;
}> {
  const q = new URLSearchParams({ revision: String(revision) });
  const resp = await fetch(
    getBase(settings) +
      '/api/practice/sessions/' +
      encodeURIComponent(sessionId) +
      '/check?' +
      q.toString(),
    { headers: headers(settings) }
  );
  const data = await readJson(resp);
  if (!resp.ok) {
    return { match: false, serverRevision: null, serverUpdatedAt: null, gone: true };
  }
  return {
    match: !!data.match,
    serverRevision:
      data.serverRevision == null ? null : Number(data.serverRevision),
    serverUpdatedAt:
      data.serverUpdatedAt == null ? null : Number(data.serverUpdatedAt),
    gone: !!data.gone,
  };
}

export async function patchPracticeSession(
  settings: Settings,
  sessionId: string,
  patch: {
    idx?: number;
    stats?: { correct: number; total: number };
    uiState?: Record<string, unknown>;
    clientUpdatedAt?: number;
  },
  opts?: { keepalive?: boolean }
): Promise<PatchPracticeSessionResult | null> {
  const { clientUpdatedAt, ...rest } = patch;
  let body: string;
  try {
    body = safeJsonBody({
      ...rest,
      clientUpdatedAt: clientUpdatedAt ?? Date.now(),
    });
  } catch (e) {
    return {
      error: 'serialize_failed',
      body: e instanceof Error ? e.message : String(e),
    };
  }

  let resp: Response;
  const controller = new AbortController();
  const timeoutMs = opts?.keepalive ? 8000 : 25000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    resp = await fetch(
      getBase(settings) + '/api/practice/sessions/' + encodeURIComponent(sessionId),
      {
        method: 'PATCH',
        headers: headers(settings),
        body,
        keepalive: !!opts?.keepalive,
        signal: controller.signal,
      }
    );
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      error: aborted ? 'timeout' : 'network',
      body: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }

  const rawText = await resp.text();
  let data: Record<string, unknown> = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }

  if (resp.status === 404) {
    return { sessionId, revision: 0, gone: true };
  }
  if (!resp.ok) {
    return {
      error: String(data.error || 'http_error'),
      status: resp.status,
      body: rawText.slice(0, 500) || String(data.message || ''),
    };
  }
  // 新：轻量 { sessionId, revision }；旧：整包 session（兼容过渡）
  const legacy = data.session as { sessionId?: string; revision?: number } | undefined;
  const sid = String(data.sessionId || legacy?.sessionId || sessionId);
  const revision = Number(data.revision ?? legacy?.revision);
  if (!Number.isFinite(revision)) {
    return { error: 'invalid_response', status: resp.status };
  }
  return {
    sessionId: sid,
    revision,
    applied: data.applied !== false,
  };
}

export async function putPracticeItem(
  settings: Settings,
  sessionId: string,
  ordinal: number,
  patch: {
    example?: WordExample | null;
    attempt?: Record<string, unknown> | null;
    wasNew?: boolean;
  }
): Promise<boolean> {
  const resp = await fetch(
    getBase(settings) +
      '/api/practice/sessions/' +
      encodeURIComponent(sessionId) +
      '/items/' +
      ordinal,
    {
      method: 'PUT',
      headers: headers(settings),
      body: JSON.stringify({ ...patch, clientUpdatedAt: Date.now() }),
    }
  );
  if (!resp.ok) return false;
  const data = await readJson(resp);
  return data.applied !== false;
}

/** 一次请求写多道题的 example / attempt */
export async function putPracticeItemsBatch(
  settings: Settings,
  sessionId: string,
  items: Array<{
    ordinal: number;
    example?: WordExample | null;
    attempt?: Record<string, unknown> | null;
    wasNew?: boolean;
  }>
): Promise<number> {
  if (!items.length) return 0;
  const resp = await fetch(
    getBase(settings) +
      '/api/practice/sessions/' +
      encodeURIComponent(sessionId) +
      '/items',
    {
      method: 'PUT',
      headers: headers(settings),
      body: JSON.stringify({
        items: items.map((it) => ({ ...it, clientUpdatedAt: Date.now() })),
      }),
    }
  );
  if (!resp.ok) return 0;
  const data = await readJson(resp);
  return Number(data.applied) || 0;
}

export async function completePracticeSession(
  settings: Settings,
  sessionId: string
): Promise<void> {
  const resp = await fetch(
    getBase(settings) +
      '/api/practice/sessions/' +
      encodeURIComponent(sessionId) +
      '/complete',
    { method: 'POST', headers: headers(settings), body: '{}' }
  );
  if (!resp.ok && resp.status !== 404) {
    const data = await readJson(resp);
    throw new PracticeCloudError(String(data.error || '结束练习失败'), resp.status);
  }
}

export async function abandonPracticeSession(
  settings: Settings,
  sessionId: string
): Promise<void> {
  const resp = await fetch(
    getBase(settings) +
      '/api/practice/sessions/' +
      encodeURIComponent(sessionId) +
      '/abandon',
    { method: 'POST', headers: headers(settings), body: '{}' }
  );
  if (!resp.ok && resp.status !== 404) {
    const data = await readJson(resp);
    throw new PracticeCloudError(String(data.error || '放弃练习失败'), resp.status);
  }
}

/** 删除当前用户所有 active 练习会话（meta 丢失时的兜底） */
export async function deleteActivePracticeSessions(
  settings: Settings
): Promise<void> {
  const resp = await fetch(getBase(settings) + '/api/practice/active', {
    method: 'DELETE',
    headers: headers(settings),
  });
  if (!resp.ok && resp.status !== 404) {
    const data = await readJson(resp);
    throw new PracticeCloudError(String(data.error || '删除练习会话失败'), resp.status);
  }
}
