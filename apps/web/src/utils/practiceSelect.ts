import { buildClozeChoices, getClozeExpectedForm } from '@/api/llm';
import { isDue, isNew } from '@/utils/scheduler';
import type { Word, WordExample } from '@/types/word';
import type { PracticeMode, StudyScope } from '@/utils/practiceSession';
export type { StudyScope } from '@/utils/practiceSession';
export { parseStudyScope, scopeLabel as studyScopeLabel } from '@/utils/practiceSession';

export type Mode = PracticeMode;

/** One session at most 50 words — finish then start another batch for the rest */
export const SESSION_SIZE = 50;

export interface Question {
  word: Word;
  example: WordExample;
  /** Debug: where the sentence came from */
  source?: 'llm' | 'fallback' | 'cache' | 'session';
  /** Snapshot at session start — for 新词 / 复习 badge */
  wasNew?: boolean;
}

export function isClozeFamily(m: Mode): boolean {
  return m === 'cloze' || m === 'choice';
}

export function llmGenMode(m: Mode): 'cloze' | 'translate' {
  return m === 'translate' ? 'translate' : 'cloze';
}

export function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export function selectNewWords(all: Word[]): Word[] {
  return shuffle(all.filter((w) => !w.crossedOut && isNew(w)));
}

export function selectReviewWords(all: Word[]): Word[] {
  const due = all.filter((w) => !w.crossedOut && !isNew(w) && isDue(w));
  return shuffle(due);
}

export function selectDailyWords(all: Word[]): Word[] {
  // Mixed: new first, then due, then soon
  return [...selectNewWords(all), ...selectReviewWords(all)];
}

/** Starred words for focused review (ignores due schedule) */
export function selectStarredWords(all: Word[]): Word[] {
  return shuffle(all.filter((w) => !w.crossedOut && !!w.starred));
}

/** Pick up to SESSION_SIZE words for this round, preserving scope priority */
export function pickSessionWords(all: Word[], scope: StudyScope = 'mixed'): Word[] {
  const pool =
    scope === 'new'
      ? selectNewWords(all)
      : scope === 'review'
        ? selectReviewWords(all)
        : scope === 'starred'
          ? selectStarredWords(all)
          : selectDailyWords(all);
  return pool.slice(0, SESSION_SIZE);
}

export function countByScope(all: Word[]): {
  newCount: number;
  reviewCount: number;
  mixedCount: number;
  starredCount: number;
} {
  const newCount = all.filter((w) => !w.crossedOut && isNew(w)).length;
  const reviewCount = selectReviewWords(all).length;
  const starredCount = all.filter((w) => !w.crossedOut && !!w.starred).length;
  return {
    newCount,
    reviewCount,
    mixedCount: newCount + reviewCount,
    starredCount,
  };
}

export function exampleFromCache(
  word: Word,
  sentence: { en: string; zh: string },
  mode: Mode,
  distractors: string[]
): WordExample {
  if (mode === 'translate') {
    return { en: sentence.en, zh: sentence.zh };
  }
  if (mode === 'choice') {
    const choices = buildClozeChoices(word.word, distractors);
    return {
      en: sentence.en,
      zh: sentence.zh,
      blank: word.word,
      ...choices,
    };
  }
  // type-in cloze — no MCQ options needed
  return {
    en: sentence.en,
    zh: sentence.zh,
    blank: getClozeExpectedForm(word.word, sentence.en) || word.word,
  };
}
