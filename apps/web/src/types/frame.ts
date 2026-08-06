import type { SrsProgress } from '@/types/srsProgress';

export type FrameSource = 'bank' | 'manual';

export interface FrameSlot {
  key: string;
  hintZh: string;
  optional?: boolean;
}

export interface Frame {
  id: string;
  title: string;
  frameKey: string;
  skeleton: string;
  slots: FrameSlot[];
  glossZh: string;
  anchorWordIds?: string[];
  exampleFilled?: string;
  packId?: string;
  source: FrameSource;
  createdAt: number;
  updatedAt?: number;
}

export type FrameWithProgress = Frame & {
  progress: SrsProgress;
};

export function normalizeFrameKey(skeletonOrTitle: string): string {
  return String(skeletonOrTitle || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
