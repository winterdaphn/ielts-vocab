/**
 * Daily learning log — powers the learning curve on Today page.
 * Stored per-user in localStorage as JSON map of dayKey → day stats.
 */

import { getLS, setLS, todayKey } from '@/utils/date';

export interface LearningDayStat {
  /** Calendar key (Date.toDateString()) */
  day: string;
  /** Reviews completed (answered cards) */
  reviewed: number;
  /** Cards that were new (totalReviews was 0 before this review) */
  newLearned: number;
  correct: number;
}

type LogMap = Record<string, LearningDayStat>;

const LOG_KEY = 'learning-log';
const MAX_DAYS = 90;

function readLog(): LogMap {
  try {
    const raw = getLS(LOG_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as LogMap;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeLog(map: LogMap): void {
  // Prune oldest beyond MAX_DAYS
  const keys = Object.keys(map).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );
  if (keys.length > MAX_DAYS) {
    for (const k of keys.slice(0, keys.length - MAX_DAYS)) delete map[k];
  }
  try {
    setLS(LOG_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Record one answered card. Call after a successful review write. */
export function recordLearningEvent(opts: {
  wasNew: boolean;
  correct: boolean;
}): void {
  const day = todayKey();
  const map = readLog();
  const cur = map[day] || { day, reviewed: 0, newLearned: 0, correct: 0 };
  cur.reviewed += 1;
  if (opts.wasNew) cur.newLearned += 1;
  if (opts.correct) cur.correct += 1;
  map[day] = cur;
  writeLog(map);
}

/** Last N calendar days (oldest → newest), filling zeros for missing days. */
export function getLearningCurve(days = 14): LearningDayStat[] {
  const map = readLog();
  const out: LearningDayStat[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = d.toDateString();
    out.push(map[key] || { day: key, reviewed: 0, newLearned: 0, correct: 0 });
  }
  return out;
}

export function dayLabelShort(dayKey: string): string {
  const d = new Date(dayKey);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
