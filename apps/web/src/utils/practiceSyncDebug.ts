import { readSavedPracticeSession } from '@/utils/practiceSession';
import { getLS } from '@/utils/date';
import { useSettings } from '@/store/useSettings';

const CLOUD_META_KEY = 'practice-cloud-meta';

const lastFailureAt = new Map<string, number>();
const FAILURE_DEBOUNCE_MS = 12000;

let failureHandler: ((message: string) => void) | null = null;
let boundSessionId: string | null = null;
let boundSource = '';

export function setPracticeSyncFailureHandler(handler: ((message: string) => void) | null) {
  failureHandler = handler;
}

/** 统一前缀，vConsole / 桌面 DevTools 都能看 */
export function practiceSyncLog(
  level: 'info' | 'warn' | 'error',
  tag: string,
  message: string,
  detail?: unknown
): void {
  const prefix = `[${tag}] ${message}`;
  if (level === 'error') console.error(prefix, detail ?? '');
  else if (level === 'warn') console.warn(prefix, detail ?? '');
  else console.info(prefix, detail ?? '');
}

export function setPracticeSyncBoundSession(sessionId: string | null, source: string) {
  boundSessionId = sessionId;
  boundSource = source;
  practiceSyncLog('info', 'practice-bind', sessionId ? '已绑定云端 session' : '未绑定云端 session', {
    sessionId,
    source,
  });
}

export function getPracticeSyncDiagnostics() {
  const settings = useSettings.getState();
  const local = readSavedPracticeSession();
  let cloudMeta: { sessionId: string; revision: number } | null = null;
  try {
    const raw = getLS(CLOUD_META_KEY);
    if (raw) {
      const o = JSON.parse(raw) as { sessionId?: string; revision?: number };
      if (o?.sessionId) cloudMeta = { sessionId: o.sessionId, revision: Number(o.revision) || 0 };
    }
  } catch {
    /* ignore */
  }
  return {
    syncToken: !!settings.syncToken,
    workerUrl: settings.workerUrl || '(empty)',
    boundSessionId,
    boundSource,
    cloudMeta,
    local: local
      ? {
          idx: local.idx,
          total: local.wordIds.length,
          stats: local.stats,
          savedAt: local.savedAt,
          mode: local.mode,
        }
      : null,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  };
}

/** 仅失败时 toast；同类错误 12s 内不重复 */
export function notifyPracticeSyncFailure(reason: string, userMessage: string, detail?: unknown) {
  practiceSyncLog('error', 'practice-sync', userMessage, { reason, ...(detail ? { detail } : {}) });
  const now = Date.now();
  if (now - (lastFailureAt.get(reason) ?? 0) < FAILURE_DEBOUNCE_MS) return;
  lastFailureAt.set(reason, now);
  failureHandler?.(userMessage);
}
