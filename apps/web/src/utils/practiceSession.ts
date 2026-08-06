/**
 * Practice session persistence — mirrors example.html PRACTICE_SESSION_KEY logic.
 * Stored per-user via lsKey('practice-session').
 *
 * Local save keeps prefetched examples for same-device resume.
 * Cloud sync only carries a compact snapshot (mode / wordIds / idx / stats) —
 * no in-progress answers; remaining questions regenerate on open.
 */

import { getLS, setLS, delLS } from '@/utils/date';
import type { Word, WordExample } from '@/types/word';
import { resolveSessionWordId } from '@/utils/migrateWordIds';

export type PracticeMode = 'cloze' | 'choice' | 'translate';
export type StudyScope = 'new' | 'review' | 'mixed' | 'starred';
/** Sentence generation difficulty for cloze / choice / translate */
export type SentenceDifficulty = 'easy' | 'medium' | 'hard';

export function modeLabel(mode: PracticeMode): string {
  if (mode === 'choice') return '选词填空';
  if (mode === 'translate') return '句子翻译';
  return '输入填空';
}

export function scopeLabel(scope: StudyScope): string {
  if (scope === 'new') return '学新词';
  if (scope === 'review') return '复习';
  if (scope === 'starred') return '星标';
  return '混合';
}

export function difficultyLabel(d: SentenceDifficulty): string {
  if (d === 'easy') return '简单';
  if (d === 'hard') return '困难';
  return '中等';
}

export function parsePracticeMode(raw: string | null | undefined): PracticeMode {
  if (raw === 'choice' || raw === 'cloze-choice') return 'choice';
  if (raw === 'translate') return 'translate';
  return 'cloze';
}

export function parseStudyScope(raw: string | null | undefined): StudyScope {
  if (raw === 'new' || raw === 'review' || raw === 'starred') return raw;
  return 'mixed';
}

export function parseSentenceDifficulty(
  raw: string | null | undefined
): SentenceDifficulty {
  if (raw === 'easy' || raw === 'hard' || raw === 'medium') return raw;
  return 'medium';
}

export interface SavedPracticeSession {
  version: 1;
  savedAt: number;
  mode: PracticeMode;
  /** new | review | mixed — optional for old sessions */
  scope?: StudyScope;
  /** easy | medium | hard — optional for old sessions */
  difficulty?: SentenceDifficulty;
  wordIds: string[];
  idx: number;
  /** Pre-generated examples keyed by word id (local only; not synced) */
  examples: Record<string, WordExample>;
  stats: { correct: number; total: number };
  showAnswer: boolean;
  /** 输入填空：是否已点「提示」看整句翻译 */
  hintShown?: boolean;
  /** 句子翻译：AI 提示阶梯 0–3 */
  translateHintLevel?: number;
  translateHints?: { structure: string; keywords: string } | null;
  picked: string | null;
  userText: string;
  judgeResult: {
    score?: number;
    correct: boolean;
    feedback: string;
    improved?: string;
    expected?: string;
    wordCompare?: string;
    usageTip?: string;
    grammarTip?: string;
    revealed?: boolean;
  } | null;
}

/** Compact resume info for cloud sync (cross-device). */
export interface PracticeSyncSnapshot {
  version: 1;
  savedAt: number;
  mode: PracticeMode;
  scope?: StudyScope;
  difficulty?: SentenceDifficulty;
  wordIds: string[];
  idx: number;
  stats: { correct: number; total: number };
}

export interface PracticeSummary {
  mode: PracticeMode;
  modeLabel: string;
  scope: StudyScope;
  scopeLabel: string;
  difficulty: SentenceDifficulty;
  difficultyLabel: string;
  current: number;
  total: number;
  when: string;
  answered: number;
}

export function readSavedPracticeSession(): SavedPracticeSession | null {
  try {
    const raw = getLS('practice-session');
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedPracticeSession;
    if (!data || !Array.isArray(data.wordIds) || !data.wordIds.length) return null;
    if (data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

/** Prefer forward progress for the same round; otherwise prefer the newer round. */
export function choosePracticeSession(
  local: SavedPracticeSession | null,
  remote: SavedPracticeSession | null
): SavedPracticeSession | null {
  const active = (saved: SavedPracticeSession | null) =>
    !!saved && saved.idx < saved.wordIds.length;
  if (!active(local)) return active(remote) ? remote : null;
  if (!active(remote)) return local;
  if (!local || !remote) return local || remote;

  const sameRound =
    parsePracticeMode(local.mode) === parsePracticeMode(remote.mode) &&
    parseStudyScope(local.scope) === parseStudyScope(remote.scope) &&
    parseSentenceDifficulty(local.difficulty) ===
      parseSentenceDifficulty(remote.difficulty) &&
    local.wordIds.length === remote.wordIds.length &&
    local.wordIds.every((id, i) => id === remote.wordIds[i]);

  if (sameRound) {
    if (local.idx !== remote.idx) return local.idx > remote.idx ? local : remote;
    const localAnswered = local.stats?.total || 0;
    const remoteAnswered = remote.stats?.total || 0;
    if (localAnswered !== remoteAnswered) {
      return localAnswered > remoteAnswered ? local : remote;
    }
  }
  return (local.savedAt || 0) >= (remote.savedAt || 0) ? local : remote;
}

/** 题已全部作答或 idx 已越界 → 不应再展示「继续练习」 */
export function isPracticeSessionFinished(
  snap: Pick<SavedPracticeSession, 'wordIds' | 'idx' | 'stats'>
): boolean {
  const total = snap.wordIds.length;
  if (!total) return true;
  if ((snap.idx ?? 0) >= total) return true;
  if ((snap.stats?.total ?? 0) >= total) return true;
  return false;
}

export function getSavedPracticeSummary(): PracticeSummary | null {
  const saved = readSavedPracticeSession();
  if (!saved) return null;
  if (isPracticeSessionFinished(saved)) return null;
  const total = saved.wordIds.length;
  const idx = Math.min(saved.idx || 0, total);
  const scope = parseStudyScope(saved.scope);
  const difficulty = parseSentenceDifficulty(saved.difficulty);
  return {
    mode: parsePracticeMode(saved.mode),
    modeLabel: modeLabel(parsePracticeMode(saved.mode)),
    scope,
    scopeLabel: scopeLabel(scope),
    difficulty,
    difficultyLabel: difficultyLabel(difficulty),
    current: idx + 1,
    total,
    when: saved.savedAt
      ? new Date(saved.savedAt).toLocaleString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '',
    answered: saved.stats?.total ?? 0,
  };
}

export function clearPracticeSession(): void {
  delLS('practice-session');
}

/** Build cloud-safe resume snapshot (no answers / no prefetched sentences). */
export function getPracticeSyncSnapshot(): PracticeSyncSnapshot | null {
  const saved = readSavedPracticeSession();
  if (!saved) return null;
  const total = saved.wordIds.length;
  const idx = Math.min(saved.idx || 0, total);
  if (idx >= total) return null;
  if (isPracticeSessionFinished(saved)) return null;
  return {
    version: 1,
    savedAt: saved.savedAt || Date.now(),
    mode: parsePracticeMode(saved.mode),
    scope: parseStudyScope(saved.scope),
    difficulty: parseSentenceDifficulty(saved.difficulty),
    wordIds: saved.wordIds.filter(Boolean),
    idx,
    stats: {
      correct: saved.stats?.correct ?? 0,
      total: saved.stats?.total ?? 0,
    },
  };
}

/**
 * Normalize practice blob from cloud (React compact or example.html session).
 * Returns null → clear local; undefined input means "field absent, leave local".
 */
export function normalizePracticeSyncPayload(
  raw: unknown
): PracticeSyncSnapshot | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'object') return null;

  const o = raw as Record<string, unknown>;
  const wordIds = Array.isArray(o.wordIds)
    ? o.wordIds.map((id) => String(id)).filter(Boolean)
    : [];
  if (!wordIds.length) return null;

  const idxRaw =
    typeof o.idx === 'number'
      ? o.idx
      : typeof o.wordIdx === 'number'
        ? o.wordIdx
        : 0;
  const idx = Math.max(0, Math.min(idxRaw, wordIds.length - 1));

  let stats = { correct: 0, total: 0 };
  if (o.stats && typeof o.stats === 'object') {
    const s = o.stats as Record<string, unknown>;
    stats = {
      correct: Number(s.correct) || 0,
      total: Number(s.total) || 0,
    };
  } else if (Array.isArray(o.results)) {
    stats = { correct: 0, total: o.results.length };
  }

  return {
    version: 1,
    savedAt: typeof o.savedAt === 'number' ? o.savedAt : Date.now(),
    mode: parsePracticeMode(String(o.mode || 'cloze')),
    scope: parseStudyScope(typeof o.scope === 'string' ? o.scope : 'mixed'),
    difficulty: parseSentenceDifficulty(
      typeof o.difficulty === 'string' ? o.difficulty : 'medium'
    ),
    wordIds,
    idx,
    stats,
  };
}

/** Apply cloud practice snapshot locally (fresh ask state; examples regenerate). */
export function applyPracticeSyncSnapshot(snap: PracticeSyncSnapshot | null): void {
  if (!snap) {
    clearPracticeSession();
    return;
  }
  const data: SavedPracticeSession = {
    version: 1,
    savedAt: snap.savedAt || Date.now(),
    mode: parsePracticeMode(snap.mode),
    scope: parseStudyScope(snap.scope),
    difficulty: parseSentenceDifficulty(snap.difficulty),
    wordIds: snap.wordIds,
    idx: snap.idx,
    examples: {},
    stats: snap.stats || { correct: 0, total: 0 },
    showAnswer: false,
    hintShown: false,
    picked: null,
    userText: '',
    judgeResult: null,
  };
  try {
    setLS('practice-session', JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

export function savePracticeSession(payload: {
  mode: PracticeMode;
  scope?: StudyScope;
  difficulty?: SentenceDifficulty;
  sessionWords: Word[];
  idx: number;
  queue: ({ word: Word; example: WordExample; wasNew?: boolean } | null)[];
  stats: { correct: number; total: number };
  showAnswer: boolean;
  hintShown?: boolean;
  translateHintLevel?: number;
  translateHints?: { structure: string; keywords: string } | null;
  picked: string | null;
  userText: string;
  judgeResult: SavedPracticeSession['judgeResult'];
  phase: string;
}): void {
  if (payload.phase === 'done' || payload.phase === 'selecting') {
    clearPracticeSession();
    return;
  }
  if (!payload.sessionWords.length) return;

  const examples: Record<string, WordExample> = {};
  payload.queue.forEach((q, i) => {
    const w = payload.sessionWords[i];
    if (q?.example && w) examples[w.id] = q.example;
  });

  const data: SavedPracticeSession = {
    version: 1,
    savedAt: Date.now(),
    mode: payload.mode,
    scope: payload.scope || 'mixed',
    difficulty: payload.difficulty || 'medium',
    wordIds: payload.sessionWords.map((w) => w.id),
    idx: payload.idx,
    examples,
    stats: payload.stats,
    showAnswer: payload.showAnswer,
    hintShown: !!payload.hintShown,
    translateHintLevel: Math.max(0, Math.min(3, payload.translateHintLevel ?? 0)),
    translateHints: payload.translateHints || null,
    picked: payload.picked,
    userText: payload.userText,
    judgeResult: payload.judgeResult,
  };

  try {
    setLS('practice-session', JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

/** Rebuild session lists from saved snapshot + current word bank. */
export function hydratePracticeSession(
  saved: SavedPracticeSession,
  allWords: Word[]
): {
  mode: PracticeMode;
  scope: StudyScope;
  difficulty: SentenceDifficulty;
  sessionWords: Word[];
  queue: ({
    word: Word;
    example: WordExample;
    source?: 'llm' | 'fallback' | 'cache' | 'session';
    wasNew?: boolean;
  } | null)[];
  idx: number;
  stats: { correct: number; total: number };
  showAnswer: boolean;
  hintShown: boolean;
  translateHintLevel: number;
  translateHints: { structure: string; keywords: string } | null;
  picked: string | null;
  userText: string;
  judgeResult: SavedPracticeSession['judgeResult'];
} | null {
  const idToWord = new Map(allWords.map((w) => [w.id, w]));
  const sessionWords: Word[] = [];
  const savedIdForWord: string[] = [];
  for (const savedId of saved.wordIds) {
    const resolved = resolveSessionWordId(savedId, allWords);
    if (!resolved) continue;
    const w = idToWord.get(resolved);
    if (!w || sessionWords.some((x) => x.id === w.id)) continue;
    sessionWords.push(w);
    savedIdForWord.push(savedId);
  }
  if (!sessionWords.length) return null;

  const idSet = new Set(sessionWords.map((w) => w.id));
  let newIdx = 0;
  let found = false;
  const savedIdx = saved.idx || 0;
  for (let i = 0; i < saved.wordIds.length; i++) {
    const savedId = saved.wordIds[i];
    const resolved = resolveSessionWordId(savedId, allWords);
    if (!resolved || !idSet.has(resolved)) continue;
    if (i < savedIdx) {
      newIdx++;
      continue;
    }
    newIdx = sessionWords.findIndex((w) => w.id === resolved);
    found = true;
    break;
  }
  if (!found) newIdx = sessionWords.length;
  if (newIdx < 0 || newIdx >= sessionWords.length) return null;

  const queue = sessionWords.map((w, wi) => {
    const savedId = savedIdForWord[wi] || w.id;
    const ex = saved.examples?.[w.id] || saved.examples?.[savedId];
    return ex
      ? {
          word: w,
          example: ex,
          source: 'session' as const,
          wasNew: w.totalReviews === 0,
        }
      : null;
  });

  return {
    mode: parsePracticeMode(saved.mode),
    scope: parseStudyScope(saved.scope),
    difficulty: parseSentenceDifficulty(saved.difficulty),
    sessionWords,
    queue,
    idx: newIdx,
    stats: saved.stats || { correct: 0, total: 0 },
    showAnswer: !!saved.showAnswer,
    hintShown: !!saved.hintShown,
    translateHintLevel: Math.max(0, Math.min(3, saved.translateHintLevel ?? 0)),
    translateHints: saved.translateHints || null,
    picked: saved.picked,
    userText: saved.userText || '',
    judgeResult: saved.judgeResult || null,
  };
}
