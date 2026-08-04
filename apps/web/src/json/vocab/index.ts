/**
 * Built-in vocabulary bank (lazy-loaded JSON chunks).
 *
 * - ielts.json  — IELTS / 词汇真经
 * - kaoyan.json — 考研
 *
 * Do NOT statically import the JSON here — that balloons the main bundle (~10MB).
 */
import type { RelatedWord, Collocation, Derivative } from '@/types/word';

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
  /** 同根/派生词（有道 rel_word 等） */
  derivatives?: Derivative[];
  collocations?: Collocation[];
  /** 有道词典搭配，不覆盖 collocations */
  dictCollocations?: Collocation[];
}

export type VocabBankSource = 'ielts' | 'kaoyan';

let allCache: VocabBankEntry[] | null = null;
let allPromise: Promise<VocabBankEntry[]> | null = null;
const sourceCache = new Map<VocabBankSource, VocabBankEntry[]>();

/** Dynamic import one source — separate Vite chunk per file. */
export async function loadVocabBySource(
  source: VocabBankSource
): Promise<VocabBankEntry[]> {
  const hit = sourceCache.get(source);
  if (hit) return hit;
  if (source === 'ielts') {
    const mod = await import('./ielts.json');
    const list = mod.default as VocabBankEntry[];
    sourceCache.set(source, list);
    return list;
  }
  const mod = await import('./kaoyan.json');
  const list = mod.default as VocabBankEntry[];
  sourceCache.set(source, list);
  return list;
}

/** Load and cache both banks (still two chunks, not in the login bundle). */
export async function loadAllVocabBank(): Promise<VocabBankEntry[]> {
  if (allCache) return allCache;
  if (!allPromise) {
    allPromise = Promise.all([
      loadVocabBySource('ielts'),
      loadVocabBySource('kaoyan'),
    ]).then(([ielts, kaoyan]) => {
      allCache = [...ielts, ...kaoyan];
      return allCache;
    });
  }
  return allPromise;
}

export function getCachedVocabBank(): VocabBankEntry[] | null {
  return allCache;
}

/** Warm both JSON chunks in the background after login. */
export function prefetchVocabBank(): void {
  void loadAllVocabBank();
}
