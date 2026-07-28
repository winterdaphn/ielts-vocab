/**
 * Built-in vocabulary bank (split by source for smaller files + lazy import).
 *
 * - ielts.json  — IELTS / 词汇真经
 * - kaoyan.json — 考研
 */
import ielts from './ielts.json';
import kaoyan from './kaoyan.json';
import type { RelatedWord, Collocation } from '@/types/word';

export interface VocabBankEntry {
  word: string;
  phoneticUk?: string;
  phoneticUs?: string;
  pos?: string;
  translation?: string;
  source?: string;
  category?: string | string[];
  synonyms?: RelatedWord[];
  similars?: RelatedWord[];
  collocations?: Collocation[];
}

export type VocabBankSource = 'ielts' | 'kaoyan';

export const ieltsVocab = ielts as VocabBankEntry[];
export const kaoyanVocab = kaoyan as VocabBankEntry[];

/** Full bank (sync). Prefer loadVocabBySource for import buttons. */
export const allVocabBank: VocabBankEntry[] = [...ieltsVocab, ...kaoyanVocab];

/** Dynamic import one source — keeps the other chunk out of the import path. */
export async function loadVocabBySource(
  source: VocabBankSource
): Promise<VocabBankEntry[]> {
  if (source === 'ielts') {
    const mod = await import('./ielts.json');
    return mod.default as VocabBankEntry[];
  }
  const mod = await import('./kaoyan.json');
  return mod.default as VocabBankEntry[];
}
