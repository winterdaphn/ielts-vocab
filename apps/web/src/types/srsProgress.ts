/** Unified SRS progress — word / chunk / frame share one store & API. */

export type SrsTargetType = 'word' | 'chunk' | 'frame';

export interface SrsProgress {
  targetType: SrsTargetType;
  targetId: string;
  ease: number;
  interval: number;
  streak: number;
  nextReview: number;
  totalReviews: number;
  correctReviews: number;
  starred?: boolean;
  crossedOut?: boolean;
  updatedAt: number;
}

export function srsLocalId(targetType: SrsTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}

/** Progress fields mirrored on Word for UI / Dexie (until local srs table lands). */
export const SRS_FIELD_KEYS = [
  'ease',
  'interval',
  'streak',
  'nextReview',
  'totalReviews',
  'correctReviews',
  'crossedOut',
  'starred',
] as const;

export type SrsFieldKey = (typeof SRS_FIELD_KEYS)[number];
