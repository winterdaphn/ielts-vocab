import { useWordsStore } from '@/store/useWords';
import type { Word } from '@/types/word';

export function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  );
}

export function latestWordSnapshot(word: Word, words: Word[]): Word {
  const candidates = [
    word,
    words.find((item) => item.id === word.id),
    useWordsStore.getState().words.find((item) => item.id === word.id),
  ].filter((item): item is Word => !!item);
  return candidates.reduce((best, item) =>
    (item.updatedAt || 0) > (best.updatedAt || 0) ? item : best
  );
}
