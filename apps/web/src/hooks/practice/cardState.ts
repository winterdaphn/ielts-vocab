import { isClozeFamily, type Mode, type Question } from '@/utils/practiceSelect';
import type { Word } from '@/types/word';
import type { AttemptRecord, CardSnapshot, JudgeResult, SessionReviewItem } from './types';

export function computeMaxJumpIdx(args: {
  mode: Mode;
  idx: number;
  showAnswer: boolean;
  picked: string | null;
  judgeResult: JudgeResult;
  cardStates: Map<number, CardSnapshot>;
  attempts: Map<number, AttemptRecord>;
  reviewedIndices: Set<number>;
}): number {
  const { mode, idx, showAnswer, picked, judgeResult, cardStates, attempts, reviewedIndices } =
    args;
  let max = -1;
  const mark = (i: number) => {
    max = Math.max(max, i);
  };

  reviewedIndices.forEach(mark);
  attempts.forEach((_, i) => mark(i));
  cardStates.forEach((snap, i) => {
    if (snap.showAnswer || snap.judgeResult) mark(i);
  });

  const currentDone =
    mode === 'choice'
      ? picked !== null
      : mode === 'translate'
        ? !!judgeResult
        : showAnswer;
  if (currentDone) mark(idx);

  return Math.max(0, max);
}

export function buildSessionReviewList(
  sessionWords: Word[],
  attempts: Map<number, AttemptRecord>
): SessionReviewItem[] {
  return sessionWords.map((w, i) => {
    const attempt = attempts.get(i);
    return {
      word: w.word,
      translation: w.translation || undefined,
      correct: attempt ? attempt.correct : null,
    };
  });
}

export function answeredReviewJudge(correct: boolean): NonNullable<JudgeResult> {
  return { correct, feedback: '（已作答）', revealed: !correct };
}

export function ensureClozeReviewJudge(
  m: Mode,
  revealed: boolean,
  judge: JudgeResult
): JudgeResult {
  if (judge) return judge;
  if (m !== 'cloze' && m !== 'choice') return judge;
  if (!revealed) return judge;
  return answeredReviewJudge(true);
}

export function cardSnapshotFromAttempt(
  attempt: Record<string, unknown>,
  m: Mode
): CardSnapshot | null {
  const picked = typeof attempt.picked === 'string' ? attempt.picked : null;
  const judgeResult = (attempt.judgeResult as JudgeResult) ?? null;
  const correct = !!attempt.correct;

  if (m === 'choice') {
    if (!picked) return null;
    return {
      showAnswer: true,
      picked,
      judgeResult: null,
      hintShown: false,
      translateHintLevel: 0,
      translateHints: null,
    };
  }
  if (m === 'translate') {
    return {
      showAnswer: false,
      picked: null,
      judgeResult: judgeResult ?? { correct, feedback: '（已作答）' },
      hintShown: false,
      translateHintLevel: 0,
      translateHints: null,
    };
  }
  return {
    showAnswer: true,
    picked: null,
    judgeResult: judgeResult ?? {
      correct,
      feedback: '（已作答）',
      revealed: !correct,
    },
    hintShown: true,
    translateHintLevel: 0,
    translateHints: null,
  };
}

export function reviewedFallbackSnapshot(m: Mode): CardSnapshot {
  return {
    showAnswer: m !== 'translate',
    picked: null,
    judgeResult:
      m === 'translate'
        ? { correct: true, feedback: '（已作答）' }
        : answeredReviewJudge(true),
    hintShown: m === 'cloze',
    translateHintLevel: 0,
    translateHints: null,
  };
}

export function resolveCardCorrect(args: {
  mode: Mode;
  ordinal: number;
  idx: number;
  picked: string | null;
  judgeResult: JudgeResult;
  cardStates: Map<number, CardSnapshot>;
  attempts: Map<number, AttemptRecord>;
  queue: (Question | null)[];
}): boolean {
  const { mode, ordinal, idx, picked, judgeResult, cardStates, attempts, queue } = args;

  if (mode === 'choice') {
    const snap = cardStates.get(ordinal);
    const letter =
      ordinal === idx ? picked : snap?.picked ?? attempts.get(ordinal)?.picked ?? null;
    const q = queue[ordinal];
    return !!letter && letter === q?.example.answer;
  }

  const jr =
    ordinal === idx
      ? judgeResult
      : cardStates.get(ordinal)?.judgeResult ?? attempts.get(ordinal)?.judgeResult ?? null;
  if (jr) return !!jr.correct;
  const attempt = attempts.get(ordinal);
  if (attempt) return attempt.correct;
  return false;
}

export function seedCardStatesFromAttempts(
  items: { ordinal: number; attempt: Record<string, unknown> | null }[],
  m: Mode,
  upToIdx: number,
  cardStates: Map<number, CardSnapshot>,
  attempts: Map<number, AttemptRecord>,
  reviewedIndices: Set<number>
) {
  for (const item of items) {
    if (item.ordinal >= upToIdx || !item.attempt) continue;
    const snap = cardSnapshotFromAttempt(item.attempt, m);
    if (!snap) continue;
    cardStates.set(item.ordinal, snap);
    attempts.set(item.ordinal, {
      picked: snap.picked,
      judgeResult: snap.judgeResult,
      correct: !!item.attempt.correct,
    });
    reviewedIndices.add(item.ordinal);
  }
}

export function seedReviewedCardFallbacks(
  upToIdx: number,
  m: Mode,
  cardStates: Map<number, CardSnapshot>,
  attempts: Map<number, AttemptRecord>,
  reviewedIndices: Set<number>
) {
  for (let i = 0; i < upToIdx; i++) {
    if (cardStates.has(i)) continue;
    const attempt = attempts.get(i);
    if (attempt) {
      const snap = cardSnapshotFromAttempt(
        {
          picked: attempt.picked,
          judgeResult: attempt.judgeResult,
          correct: attempt.correct,
        },
        m
      );
      if (snap) cardStates.set(i, snap);
      continue;
    }
    if (!reviewedIndices.has(i)) continue;
    cardStates.set(i, reviewedFallbackSnapshot(m));
  }
}

export function resolveGoToCardSnapshot(args: {
  target: number;
  mode: Mode;
  statsTotal: number;
  cardStates: Map<number, CardSnapshot>;
  attempts: Map<number, AttemptRecord>;
  reviewedIndices: Set<number>;
}): CardSnapshot | 'fresh' {
  const { target, mode, statsTotal, cardStates, attempts, reviewedIndices } = args;
  const saved = cardStates.get(target);
  if (saved) return saved;

  const attempt = attempts.get(target);
  const fromAttempt = attempt
    ? cardSnapshotFromAttempt(
        {
          picked: attempt.picked,
          judgeResult: attempt.judgeResult,
          correct: attempt.correct,
        },
        mode
      )
    : null;
  if (fromAttempt) return fromAttempt;

  if (reviewedIndices.has(target) || target < statsTotal) {
    if (mode === 'translate') {
      return {
        showAnswer: false,
        picked: null,
        judgeResult: { correct: true, feedback: '（已作答）' },
        hintShown: false,
        translateHintLevel: 0,
        translateHints: null,
      };
    }
    if (isClozeFamily(mode)) {
      return reviewedFallbackSnapshot(mode);
    }
    return {
      showAnswer: true,
      picked: null,
      judgeResult: null,
      hintShown: mode === 'cloze',
      translateHintLevel: 0,
      translateHints: null,
    };
  }

  return 'fresh';
}
