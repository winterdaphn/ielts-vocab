/**
 * Debounced cloud sync for in-progress practice (per-item + session header).
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

const META_KEY = 'practice-cloud-meta';

interface CloudMeta {
  sessionId: string;
  revision: number;
}

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
    userText: String(ui.userText || ''),
    judgeResult: (ui.judgeResult as SavedPracticeSession['judgeResult']) ?? null,
  };
}

let patchTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPatch: {
  sessionId: string;
  idx: number;
  stats: { correct: number; total: number };
  uiState: Record<string, unknown>;
} | null = null;

export function bindCloudSession(session: CloudPracticeSession) {
  writeCloudMeta({ sessionId: session.sessionId, revision: session.revision });
}

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

export function scheduleCloudSessionPatch(payload: {
  sessionId: string;
  idx: number;
  stats: { correct: number; total: number };
  uiState: Record<string, unknown>;
}) {
  pendingPatch = payload;
  if (patchTimer) clearTimeout(patchTimer);
  patchTimer = setTimeout(() => {
    void flushCloudSessionPatch();
  }, 450);
}

export async function flushCloudSessionPatch(): Promise<void> {
  if (patchTimer) {
    clearTimeout(patchTimer);
    patchTimer = null;
  }
  const patch = pendingPatch;
  pendingPatch = null;
  if (!patch) return;
  const s = settings();
  if (!s.syncToken) return;
  try {
    const updated = await patchPracticeSession(s, patch.sessionId, {
      idx: patch.idx,
      stats: patch.stats,
      uiState: patch.uiState,
    });
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

export function syncCloudItemAttempt(
  sessionId: string,
  ordinal: number,
  attempt: Record<string, unknown> | null
) {
  const s = settings();
  if (!s.syncToken) return;
  void putPracticeItem(s, sessionId, ordinal, { attempt });
}

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

export async function loadActiveCloudPractice(): Promise<CloudPracticeSession | null> {
  const s = settings();
  if (!s.syncToken) return null;
  const remote = await fetchActivePracticeSession(s);
  if (remote) {
    bindCloudSession(remote);
  }
  return remote;
}

/** Returns true if local meta matches server revision. */
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
