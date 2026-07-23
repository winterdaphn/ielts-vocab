/**
 * Spaced-repetition scheduler (SM-2 inspired).
 * Score 0-5 from each review; update ease / interval / nextReview.
 */

import type { Word } from '@/types/word';

export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

/** Learning stage for tags / filtering / practice labeling */
export type WordStage = 'new' | 'learning' | 'due' | 'young' | 'mature' | 'mastered' | 'crossed';

export function applyReview(w: Word, q: ReviewQuality): Word {
  let { ease, interval, streak, totalReviews, correctReviews } = w;
  totalReviews += 1;
  if (q >= 3) correctReviews += 1;

  if (q < 3) {
    // Failed: reset interval & streak
    streak = 0;
    interval = 0;
  } else {
    streak += 1;
    if (streak === 1) interval = 1;
    else if (streak === 2) interval = 3;
    else interval = Math.round(interval * ease);
    // Adjust ease
    ease = Math.max(
      1.3,
      ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    );
  }
  const day = 24 * 60 * 60 * 1000;
  const nextReview = Date.now() + interval * day;
  return { ...w, ease, interval, streak, totalReviews, correctReviews, nextReview };
}

export function isDue(w: Word, now = Date.now()): boolean {
  return w.nextReview <= now;
}

export function isNew(w: Word): boolean {
  return w.totalReviews === 0;
}

export function isMastered(w: Word): boolean {
  return w.interval >= 21 && w.streak >= 3;
}

/** Young: short interval; mature: longer but not yet mastered */
export function getWordStage(w: Word, now = Date.now()): WordStage {
  if (w.crossedOut) return 'crossed';
  if (isNew(w)) return 'new';
  if (isDue(w, now)) return 'due';
  if (isMastered(w)) return 'mastered';
  if (w.interval >= 7) return 'mature';
  if (w.totalReviews > 0 && w.interval < 7) return 'young';
  return 'learning';
}

export function wordStageLabel(stage: WordStage): string {
  switch (stage) {
    case 'new':
      return '新词';
    case 'due':
      return '待复习';
    case 'young':
      return '巩固中';
    case 'mature':
      return '稳定';
    case 'mastered':
      return '已掌握';
    case 'crossed':
      return '已划掉';
    default:
      return '学习中';
  }
}

export function wordStageClass(stage: WordStage): string {
  switch (stage) {
    case 'new':
      return 'tag tag-new';
    case 'due':
      return 'tag tag-due';
    case 'young':
      return 'tag tag-young';
    case 'mature':
      return 'tag tag-mature';
    case 'mastered':
      return 'tag tag-mastered';
    case 'crossed':
      return 'tag tag-crossed';
    default:
      return 'tag tag-learning';
  }
}
