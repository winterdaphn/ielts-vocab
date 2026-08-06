import type { SrsProgress } from '@/types/srsProgress';

export type ChunkSource = 'dict' | 'manual' | 'bank' | 'practice';
export type ChunkKind = 'collocation' | 'discourse';

export interface Chunk {
  id: string;
  phrase: string;
  phraseKey: string;
  gloss: string;
  kind?: ChunkKind;
  tags?: string[];
  anchorWordId?: string;
  source: ChunkSource;
  exampleEn?: string;
  exampleZh?: string;
  createdAt: number;
  updatedAt?: number;
}

export type ChunkWithProgress = Chunk & {
  progress: SrsProgress;
};

export function normalizePhraseKey(phrase: string): string {
  return String(phrase || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
