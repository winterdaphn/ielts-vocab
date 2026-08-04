/**
 * Ebbinghaus forgetting-curve ladder scheduler.
 * Fixed intervals: 5min → 30min → 12h → 1d → 2d → 4d → 7d → 15d → 30d
 * Correct → advance step; wrong → reset to first step (5min).
 */

import type { Word } from '@/types/word';

export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

/** Learning stage for tags / filtering / practice labeling */
export type WordStage = 'new' | 'learning' | 'due' | 'young' | 'mature' | 'mastered' | 'crossed';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Ladder delays until next review (ms). Index 0 = after first success. */
export const EBBINGHAUS_INTERVALS_MS = [
  5 * MIN, // 5 分钟
  30 * MIN, // 30 分钟
  12 * HOUR, // 12 小时
  1 * DAY, // 1 天
  2 * DAY, // 2 天
  4 * DAY, // 4 天
  7 * DAY, // 7 天
  15 * DAY, // 15 天
  30 * DAY, // 30 天
] as const;

export const EBBINGHAUS_STEPS = EBBINGHAUS_INTERVALS_MS.length;

function clampStep(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), EBBINGHAUS_STEPS);
}

/** Interval ms for the upcoming review after `streak` consecutive successes. */
export function intervalMsForStreak(streak: number): number {
  const s = clampStep(streak);
  if (s <= 0) return EBBINGHAUS_INTERVALS_MS[0];
  // streak 1 → ladder[0], … streak 9+ → ladder[8] (cap at 30d)
  const idx = Math.min(s - 1, EBBINGHAUS_STEPS - 1);
  return EBBINGHAUS_INTERVALS_MS[idx];
}

export function formatReviewInterval(ms: number): string {
  if (ms < MIN) return '即将';
  if (ms < HOUR) {
    const m = Math.round(ms / MIN);
    return `${m} 分钟`;
  }
  if (ms < DAY) {
    const h = Math.round(ms / HOUR);
    return `${h} 小时`;
  }
  const d = Math.round((ms / DAY) * 10) / 10;
  if (d === Math.floor(d)) return `${d} 天`;
  return `${d} 天`;
}

/** Human-readable next review relative to now (or absolute when far). */
export function formatNextReview(ts: number, now = Date.now()): string {
  const delta = ts - now;
  if (delta <= 0) return '已到期';
  if (delta < HOUR) {
    const m = Math.max(1, Math.round(delta / MIN));
    return `${m} 分钟后`;
  }
  if (delta < DAY) {
    const h = Math.max(1, Math.round(delta / HOUR));
    return `${h} 小时后`;
  }
  if (delta < 2 * DAY) {
    return `明天 ${new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }
  if (delta < 7 * DAY) {
    return new Date(ts).toLocaleString('zh-CN', {
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return new Date(ts).toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  });
}

/** Ladder progress label, e.g. "第 3/9 步 · 12 小时" */
export function ladderProgressLabel(w: Word): string {
  const step = clampStep(w.streak);
  if (isNew(w) && step === 0) return `未开始 · 共 ${EBBINGHAUS_STEPS} 步`;
  const displayStep = Math.min(Math.max(step, 1), EBBINGHAUS_STEPS);
  const rungMs =
    step <= 0
      ? EBBINGHAUS_INTERVALS_MS[0]
      : EBBINGHAUS_INTERVALS_MS[Math.min(step - 1, EBBINGHAUS_STEPS - 1)];
  return `第 ${displayStep}/${EBBINGHAUS_STEPS} 步 · ${formatReviewInterval(rungMs)}`;
}

/**
 * Rough retention R = exp(-elapsed / stability).
 * Stability ≈ last scheduled interval (ms). Returns 0–1.
 */
export function estimateRetention(w: Word, now = Date.now()): number | null {
  if (isNew(w) || !w.nextReview) return null;
  const stability = intervalMsForStreak(Math.max(w.streak, 1));
  // Time since last successful schedule: nextReview - interval
  const lastReviewAt = w.nextReview - (w.interval > 0 ? w.interval * DAY : stability);
  const elapsed = Math.max(0, now - lastReviewAt);
  const r = Math.exp(-elapsed / Math.max(stability, MIN));
  return Math.max(0, Math.min(1, r));
}

export function applyReview(w: Word, q: ReviewQuality): Word {
  let { ease, streak, totalReviews, correctReviews } = w;
  totalReviews += 1;
  if (q >= 3) correctReviews += 1;

  const now = Date.now();
  let nextMs: number;

  if (q < 3) {
    // Failed: back to first rung (5 min)
    streak = 0;
    nextMs = EBBINGHAUS_INTERVALS_MS[0];
  } else {
    streak = clampStep(streak) + 1;
    if (streak > EBBINGHAUS_STEPS) streak = EBBINGHAUS_STEPS;
    nextMs = intervalMsForStreak(streak);
  }

  const interval = nextMs / DAY; // days (fractional OK)
  const nextReview = now + nextMs;
  // ease kept for sync compat only
  return { ...w, ease, interval, streak, totalReviews, correctReviews, nextReview };
}

export function isDue(w: Word, now = Date.now()): boolean {
  return w.nextReview <= now;
}

export function isNew(w: Word): boolean {
  return w.totalReviews === 0;
}

export function isMastered(w: Word): boolean {
  return clampStep(w.streak) >= EBBINGHAUS_STEPS;
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
