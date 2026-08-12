/**
 * 练习进度的云端同步（登录后、有 syncToken 时生效）。
 *
 * 分两层：
 * 1) 会话头 session：第几题 idx、对错统计 stats、当前题 UI（是否揭晓等）
 *    → scheduleCloudSessionPatch / flushCloudSessionPatch
 * 2) 题目行 item：
 *    - example：仅 LLM 新生成的句子要上传；续做时已从云端拉回的不要再 PUT
 *    - attempt：点下一题后的作答记录
 *    → syncCloudItemExample / syncCloudItemAttempt
 *
 * 词库收藏例句（words.examples）是另一条路，做题页「收藏例句」才写入。
 */
import { useSettings } from '@/store/useSettings';
import type { WordExample } from '@/types/word';
import type { SavedPracticeSession } from '@/utils/practiceSession';
import {
  abandonPracticeSession,
  checkPracticeSession,
  completePracticeSession,
  createPracticeSession,
  deleteActivePracticeSessions,
  fetchActivePracticeSession,
  patchPracticeSession,
  putPracticeItemsBatch,
  type CloudPracticeSession,
} from '@/api/practiceCloud';
import type { PracticeMode, SentenceDifficulty, StudyScope } from '@/utils/practiceSession';
import { isPracticeSessionFinished } from '@/utils/practiceSession';
import { getLS, setLS, delLS } from '@/utils/date';

/** localStorage 键：记住当前云端会话 id + revision，用来做续做/冲突检测 */
const META_KEY = 'practice-cloud-meta';

interface CloudMeta {
  sessionId: string;
  revision: number;
}

/** 要 PATCH 到会话头的最新快照（只保留最后一版） */
type SessionPatch = {
  sessionId: string;
  idx: number;
  stats: { correct: number; total: number };
  uiState: Record<string, unknown>;
  /** 与本地 savedAt 对齐，供服务端 client_updated_at LWW */
  clientUpdatedAt: number;
};

function settings() {
  return useSettings.getState();
}

export function readCloudMeta(): CloudMeta | null {
  try {
    const raw = getLS(META_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as CloudMeta;
    if (!o?.sessionId) return null;
    return o;
  } catch {
    return null;
  }
}

function writeCloudMeta(meta: CloudMeta | null) {
  if (!meta) delLS(META_KEY);
  else setLS(META_KEY, JSON.stringify(meta));
}

/**
 * 把云端 active 会话转成和本机 SavedPracticeSession 一样的结构，方便 hydrate。
 * 草稿输入 userText 故意不恢复——续做时重新填即可。
 */
export function cloudSessionFromSaved(
  remote: CloudPracticeSession
): SavedPracticeSession {
  const examples: Record<string, WordExample> = {};
  for (const it of remote.items) {
    if (it.example) examples[it.wordId] = it.example;
  }
  const ui = remote.uiState || {};
  return {
    version: 1,
    savedAt: remote.updatedAt,
    mode: remote.mode,
    scope: remote.scope,
    difficulty: remote.difficulty,
    wordIds: remote.items.map((it) => it.wordId),
    idx: remote.idx,
    examples,
    stats: remote.stats,
    showAnswer: !!ui.showAnswer,
    hintShown: !!ui.hintShown,
    translateHintLevel: Number(ui.translateHintLevel) || 0,
    translateHints:
      (ui.translateHints as SavedPracticeSession['translateHints']) || null,
    picked: (ui.picked as string) ?? null,
    userText: '',
    judgeResult: (ui.judgeResult as SavedPracticeSession['judgeResult']) ?? null,
  };
}

/** 尚未发出、或发完前又被更新的会话头补丁（始终只留最新） */
let pendingPatch: SessionPatch | null = null;
/** 正在飞的 flush Promise；有值表示已有请求在路上 */
let flushPromise: Promise<void> | null = null;
/** 上一份已排队/发出的会话头指纹，内容不变就别再 PATCH */
let lastSessionPatchKey: string | null = null;

function sessionPatchKey(p: SessionPatch): string {
  return JSON.stringify({
    sessionId: p.sessionId,
    idx: p.idx,
    stats: p.stats,
    uiState: p.uiState,
    clientUpdatedAt: p.clientUpdatedAt,
  });
}

/** 开练/拉到云端会话后，把 sessionId 记到本机 */
export function bindCloudSession(session: CloudPracticeSession) {
  writeCloudMeta({ sessionId: session.sessionId, revision: session.revision });
  lastSessionPatchKey = null;
}

/** 创建云端练习会话；失败时返回 null，本机仍可离线做题 */
export async function startCloudPracticeSession(opts: {
  mode: PracticeMode;
  scope: StudyScope;
  difficulty: SentenceDifficulty;
  wordIds: string[];
  wasNewByWordId: Record<string, boolean>;
}): Promise<CloudPracticeSession | null> {
  const s = settings();
  if (!s.syncToken) return null;
  try {
    const session = await createPracticeSession(s, opts);
    bindCloudSession(session);
    console.info('[practice-cloud] session created', session.sessionId);
    return session;
  } catch (e) {
    console.warn('[practice-cloud] create failed', e);
    return null;
  }
}

/**
 * 真正把 pendingPatch 打到服务器。
 * keepalive：关页/切后台时用，尽量让浏览器把请求发出去。
 */
async function drainCloudSessionPatch(opts?: { keepalive?: boolean }): Promise<void> {
  const s = settings();
  if (!s.syncToken) {
    pendingPatch = null;
    return;
  }
  while (pendingPatch) {
    const patch = pendingPatch;
    pendingPatch = null;
    try {
      const updated = await patchPracticeSession(
        s,
        patch.sessionId,
        {
          idx: patch.idx,
          stats: patch.stats,
          uiState: patch.uiState,
          clientUpdatedAt: patch.clientUpdatedAt,
        },
        opts
      );
      if (updated?.gone) {
        writeCloudMeta(null);
        lastSessionPatchKey = null;
        continue;
      }
      if (updated) {
        writeCloudMeta({
          sessionId: updated.sessionId,
          revision: updated.revision,
        });
      }
    } catch (e) {
      console.warn('[practice-cloud] patch failed', e);
      // 失败时允许同内容重试
      if (lastSessionPatchKey === sessionPatchKey(patch)) {
        lastSessionPatchKey = null;
      }
    }
  }
}

/**
 * 保证同一时刻只有一条会话头请求在飞。
 * 路上又来了新进度 → 先进 pending，当前这条结束后立刻再发最新版。
 * （替代以前的 450ms debounce）
 */
function ensureCloudSessionFlush(opts?: { keepalive?: boolean }): Promise<void> {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    try {
      await drainCloudSessionPatch(opts);
    } finally {
      flushPromise = null;
      if (pendingPatch) {
        void ensureCloudSessionFlush(opts);
      }
    }
  })();
  return flushPromise;
}

/**
 * 会话头：有更新就立刻排队发出（不等 450ms）。
 * 调用方不用 await；退出时请再调 flushCloudSessionPatch 等它飞完。
 */
export function scheduleCloudSessionPatch(payload: SessionPatch) {
  const key = sessionPatchKey(payload);
  if (key === lastSessionPatchKey) return;
  lastSessionPatchKey = key;
  pendingPatch = payload;
  void ensureCloudSessionFlush();
}

/**
 * 强制把会话头补丁发完。
 * - 退出练习 / 完成 / 放弃：应 await
 * - 关页：可传 { keepalive: true }
 */
export async function flushCloudSessionPatch(opts?: {
  keepalive?: boolean;
}): Promise<void> {
  if (!pendingPatch && !flushPromise) return;
  await ensureCloudSessionFlush(opts);
}

/**
 * 题目行补丁队列：同一 session 内按 ordinal 合并，批量一次发出。
 * 避免开练预取时「一词一请求」把网络打爆。
 */
type ItemPatch = {
  ordinal: number;
  example?: WordExample | null;
  attempt?: Record<string, unknown> | null;
  wasNew?: boolean;
};

const pendingItemsBySession = new Map<string, Map<number, ItemPatch>>();
const itemFlushPromises = new Map<string, Promise<void>>();
/** 预取爆发时稍等再发，把多道题合成一批 */
const itemFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

function queueItemPatch(sessionId: string, patch: ItemPatch) {
  let map = pendingItemsBySession.get(sessionId);
  if (!map) {
    map = new Map();
    pendingItemsBySession.set(sessionId, map);
  }
  const prev = map.get(patch.ordinal) || { ordinal: patch.ordinal };
  map.set(patch.ordinal, {
    ordinal: patch.ordinal,
    example: patch.example !== undefined ? patch.example : prev.example,
    attempt: patch.attempt !== undefined ? patch.attempt : prev.attempt,
    wasNew: patch.wasNew !== undefined ? patch.wasNew : prev.wasNew,
  });
}

function scheduleItemsFlush(sessionId: string) {
  const prev = itemFlushTimers.get(sessionId);
  if (prev) clearTimeout(prev);
  itemFlushTimers.set(
    sessionId,
    setTimeout(() => {
      itemFlushTimers.delete(sessionId);
      void ensureCloudItemsFlush(sessionId);
    }, 120)
  );
}

async function drainCloudItemPatches(sessionId: string): Promise<void> {
  const s = settings();
  const map = pendingItemsBySession.get(sessionId);
  if (!s.syncToken || !map || map.size === 0) {
    pendingItemsBySession.delete(sessionId);
    return;
  }
  const items = [...map.values()];
  map.clear();
  pendingItemsBySession.delete(sessionId);
  try {
    const applied = await putPracticeItemsBatch(s, sessionId, items);
    if (applied > 0) {
      console.info('[practice-cloud] items batch', { sessionId, applied, queued: items.length });
    }
  } catch (e) {
    console.warn('[practice-cloud] items batch failed', e);
    for (const it of items) queueItemPatch(sessionId, it);
  }
}

function ensureCloudItemsFlush(sessionId: string): Promise<void> {
  const timer = itemFlushTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    itemFlushTimers.delete(sessionId);
  }
  const existing = itemFlushPromises.get(sessionId);
  if (existing) return existing;
  const p = (async () => {
    try {
      await drainCloudItemPatches(sessionId);
    } finally {
      itemFlushPromises.delete(sessionId);
      if ((pendingItemsBySession.get(sessionId)?.size || 0) > 0) {
        void ensureCloudItemsFlush(sessionId);
      }
    }
  })();
  itemFlushPromises.set(sessionId, p);
  return p;
}

/**
 * 题目行：LLM 新造的例句写入合并队列（~120ms 合成 1 次批量 PUT）。
 * 已从云端 active 拉回来的句子不要调这个。
 */
export function syncCloudItemExample(
  sessionId: string,
  ordinal: number,
  example: WordExample,
  wasNew?: boolean
) {
  const s = settings();
  if (!s.syncToken) return;
  queueItemPatch(sessionId, { ordinal, example, wasNew });
  scheduleItemsFlush(sessionId);
}

/**
 * 题目行：作答记录进同一批队列（点「下一题」时调用）。
 */
export function syncCloudItemAttempt(
  sessionId: string,
  ordinal: number,
  attempt: Record<string, unknown> | null
) {
  const s = settings();
  if (!s.syncToken) return;
  queueItemPatch(sessionId, { ordinal, attempt });
  scheduleItemsFlush(sessionId);
}

/** 把未发出的题目行补丁发完 */
export async function flushCloudItemPatches(sessionId?: string): Promise<void> {
  if (sessionId) {
    await ensureCloudItemsFlush(sessionId);
    return;
  }
  const ids = new Set<string>([
    ...pendingItemsBySession.keys(),
    ...itemFlushPromises.keys(),
  ]);
  await Promise.all([...ids].map((id) => ensureCloudItemsFlush(id)));
}

/** 本轮练完：先 flush，再删云端会话；仅删除成功后才清 meta */
let endCloudInFlight: Promise<void> | null = null;

export async function endCloudPracticeSession(): Promise<void> {
  if (endCloudInFlight) return endCloudInFlight;

  endCloudInFlight = (async () => {
    const meta = readCloudMeta();
    if (!meta?.sessionId) {
      await purgeActiveCloudPractice();
      return;
    }
    await flushCloudSessionPatch();
    await flushCloudItemPatches(meta.sessionId);
    const s = settings();
    if (s.syncToken) {
      await completePracticeSession(s, meta.sessionId);
      console.info('[practice-cloud] session completed', meta.sessionId);
    }
    writeCloudMeta(null);
    lastSessionPatchKey = null;
  })();

  try {
    await endCloudInFlight;
  } finally {
    endCloudInFlight = null;
  }
}

/** 放弃本轮：先 flush，再删云端会话；仅删除成功后才清 meta */
export async function abandonCloudPracticeSession(): Promise<void> {
  const meta = readCloudMeta();
  if (!meta?.sessionId) {
    await purgeActiveCloudPractice();
    return;
  }
  await flushCloudSessionPatch();
  await flushCloudItemPatches(meta.sessionId);
  const s = settings();
  if (s.syncToken) {
    await abandonPracticeSession(s, meta.sessionId);
    console.info('[practice-cloud] session abandoned', meta.sessionId);
  }
  writeCloudMeta(null);
  lastSessionPatchKey = null;
}

/** 删掉服务器上所有 active 会话（无 sessionId 或 meta 已丢时的兜底） */
export async function purgeActiveCloudPractice(): Promise<void> {
  const s = settings();
  if (!s.syncToken) {
    clearCloudPracticeMeta();
    return;
  }
  await deleteActivePracticeSessions(s);
  clearCloudPracticeMeta();
}

/** 仅清本机记住的 sessionId（开新练前；服务器 active 由 POST /sessions 删除） */
export function clearCloudPracticeMeta(): void {
  writeCloudMeta(null);
  lastSessionPatchKey = null;
}

/** 首页发现「题已做完但云端仍是 active」时收尾，避免继续卡片误显示 */
export async function completeStaleCloudPractice(sessionId: string): Promise<void> {
  const s = settings();
  if (!s.syncToken || !sessionId) return;
  const meta = readCloudMeta();
  try {
    await completePracticeSession(s, sessionId);
    console.info('[practice-cloud] stale session completed', sessionId);
  } catch (e) {
    console.warn('[practice-cloud] stale complete failed', e);
    throw e;
  } finally {
    if (meta?.sessionId === sessionId) {
      writeCloudMeta(null);
      lastSessionPatchKey = null;
    }
  }
}

/** 拉取当前用户未完成的云端练习（没有则 null） */
export async function loadActiveCloudPractice(): Promise<CloudPracticeSession | null> {
  const s = settings();
  if (!s.syncToken) return null;
  const remote = await fetchActivePracticeSession(s);
  if (!remote) return null;
  const snap = cloudSessionFromSaved(remote);
  if (isPracticeSessionFinished(snap)) {
    void completeStaleCloudPractice(remote.sessionId);
    return null;
  }
  bindCloudSession(remote);
  return remote;
}

/**
 * 本机记住的 revision 是否仍和服务器一致。
 * 不一致时更新本地 meta；会话已结束后返回 gone。
 */
export async function isCloudPracticeInSync(): Promise<boolean> {
  const meta = readCloudMeta();
  const s = settings();
  if (!s.syncToken || !meta) return !meta;
  const check = await checkPracticeSession(s, meta.sessionId, meta.revision);
  if (check.gone) {
    writeCloudMeta(null);
    return true;
  }
  if (!check.match && check.serverRevision != null) {
    writeCloudMeta({ sessionId: meta.sessionId, revision: check.serverRevision });
  }
  return check.match;
}
