/**
 * Spaced-repetition scheduler (SM-2 inspired).
 * Score 0-5 from each review; update ease / interval / nextReview.
 */

import type { Word } from '@/types/word';

export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

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
