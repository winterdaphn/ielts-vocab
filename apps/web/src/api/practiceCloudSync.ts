/**
 * 练习进度的云端同步（登录后、有 syncToken 时生效）。
 *
 * 分两层：
 * 1) 会话头 session：第几题 idx、对错统计 stats、当前题 UI（是否揭晓等）
 *    → scheduleCloudSessionPatch / flushCloudSessionPatch
 * 2) 题目行 item：这一题的例句 example、作答记录 attempt
 *    → syncCloudItemExample / syncCloudItemAttempt
 *
 * 注意：例句进「词库 words.examples」是另一条路（做题页点「收藏例句」），
 * 这里只写练习会话表 practice_sessions / practice_session_items，方便跨设备续做。
 */
import { useSettings } from '@/store/useSettings';
import type { WordExample } from '@/types/word';
import type { SavedPracticeSession } from '@/utils/practiceSession';
import {
  abandonPracticeSession,
  checkPracticeSession,
  completePracticeSession,
  createPracticeSession,
  fetchActivePracticeSession,
  patchPracticeSession,
  putPracticeItem,
  type CloudPracticeSession,
} from '@/api/practiceCloud';
import type { PracticeMode, SentenceDifficulty, StudyScope } from '@/utils/practiceSession';
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

/** 开练/拉到云端会话后，把 sessionId 记到本机 */
export function bindCloudSession(session: CloudPracticeSession) {
  writeCloudMeta({ sessionId: session.sessionId, revision: session.revision });
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
        },
        opts
      );
      if (updated) {
        writeCloudMeta({
          sessionId: updated.sessionId,
          revision: updated.revision,
        });
      }
    } catch (e) {
      console.warn('[practice-cloud] patch failed', e);
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
 * 题目行：把「这一题的例句」写到云端 practice_session_items.example。
 *
 * 当前是 fire-and-forget：`void putPracticeItem(...)`，发出去就不管成功失败。
 * 好处：预取/换句不卡 UI。
 * 风险：弱网或立刻关页时，云端可能还没这条例句，另一台续做会缺句再调 LLM。
 *
 * 若以后要加强：出题/换句成功后 await；或退出时把未确认的 item 再补发一遍。
 */
export function syncCloudItemExample(
  sessionId: string,
  ordinal: number,
  example: WordExample,
  wasNew?: boolean
) {
  const s = settings();
  if (!s.syncToken) return;
  void putPracticeItem(s, sessionId, ordinal, { example, wasNew }).then((ok) => {
    if (ok) console.info('[practice-cloud] item example', ordinal);
  });
}

/**
 * 题目行：把「这一题的作答」写到 attempt（对错、选项等）。
 * 同样 fire-and-forget；目前只在点「下一题」时由 usePracticeSession.next() 调用。
 * 草稿输入不会走这里。
 */
export function syncCloudItemAttempt(
  sessionId: string,
  ordinal: number,
  attempt: Record<string, unknown> | null
) {
  const s = settings();
  if (!s.syncToken) return;
  void putPracticeItem(s, sessionId, ordinal, { attempt });
}

/** 本轮练完：先 flush 会话头，再把云端会话标成 completed */
export async function endCloudPracticeSession(): Promise<void> {
  await flushCloudSessionPatch();
  const meta = readCloudMeta();
  writeCloudMeta(null);
  const s = settings();
  if (!s.syncToken || !meta?.sessionId) return;
  try {
    await completePracticeSession(s, meta.sessionId);
    console.info('[practice-cloud] session completed', meta.sessionId);
  } catch (e) {
    console.warn('[practice-cloud] complete failed', e);
  }
}

/** 放弃本轮：先 flush，再 abandon 云端会话 */
export async function abandonCloudPracticeSession(): Promise<void> {
  await flushCloudSessionPatch();
  const meta = readCloudMeta();
  writeCloudMeta(null);
  const s = settings();
  if (!s.syncToken || !meta?.sessionId) return;
  try {
    await abandonPracticeSession(s, meta.sessionId);
  } catch (e) {
    console.warn('[practice-cloud] abandon failed', e);
  }
}

/** 拉取当前用户未完成的云端练习（没有则 null） */
export async function loadActiveCloudPractice(): Promise<CloudPracticeSession | null> {
  const s = settings();
  if (!s.syncToken) return null;
  const remote = await fetchActivePracticeSession(s);
  if (remote) {
    bindCloudSession(remote);
  }
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
