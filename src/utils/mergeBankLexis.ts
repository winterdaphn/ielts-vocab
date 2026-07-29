import type {
  Word,
  RelatedWord,
  Collocation,
  Derivative,
} from '@/types/word';
import type { VocabBankEntry } from '@/json/vocab';
import { normalizeCategories } from '@/config/categories';

function lettersKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Local first; append bank items not already present. Fill empty local gloss from bank. */
export function mergeRelatedWords(
  local: RelatedWord[] | undefined,
  bank: RelatedWord[] | undefined,
  max = 12
): RelatedWord[] {
  const bankByKey = new Map<string, RelatedWord>();
  for (const it of bank || []) {
    const k = lettersKey(it.word);
    if (k && !bankByKey.has(k)) bankByKey.set(k, it);
  }

  const out: RelatedWord[] = [];
  const seen = new Set<string>();
  for (const it of local || []) {
    const k = lettersKey(it.word);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    let gloss = String(it.gloss || '').trim().slice(0, 40);
    if (!gloss) {
      const fromBank = bankByKey.get(k);
      if (fromBank?.gloss) gloss = String(fromBank.gloss).trim().slice(0, 40);
    }
    out.push({
      word: String(it.word || '').trim(),
      gloss,
    });
    if (out.length >= max) return out;
  }
  for (const it of bank || []) {
    const k = lettersKey(it.word);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({
      word: String(it.word || '').trim(),
      gloss: String(it.gloss || '').trim().slice(0, 40),
    });
    if (out.length >= max) break;
  }
  return out;
}

export function mergeCollocations(
  local: Collocation[] | undefined,
  bank: Collocation[] | undefined,
  max = 16
): Collocation[] {
  const out: Collocation[] = [];
  const seen = new Set<string>();
  for (const it of [...(local || []), ...(bank || [])]) {
    const k = String(it.phrase || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({
      phrase: String(it.phrase || '').trim(),
      gloss: String(it.gloss || '').trim().slice(0, 40),
    });
    if (out.length >= max) break;
  }
  return out;
}

export function mergeDerivatives(
  local: Derivative[] | undefined,
  bank: Derivative[] | undefined,
  max = 12
): Derivative[] {
  const out: Derivative[] = [];
  const seen = new Set<string>();
  for (const it of [...(local || []), ...(bank || [])]) {
    const k = lettersKey(it.word);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({
      word: String(it.word || '').trim().toLowerCase(),
      gloss: String(it.gloss || '').trim().slice(0, 40),
      ...(it.pos ? { pos: String(it.pos).trim() } : {}),
    });
    if (out.length >= max) break;
  }
  return out;
}

function sameRelated(a: RelatedWord[], b: RelatedWord[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (x, i) =>
      lettersKey(x.word) === lettersKey(b[i].word) &&
      (x.gloss || '') === (b[i].gloss || '')
  );
}

function sameColo(a: Collocation[], b: Collocation[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (x, i) =>
      x.phrase.toLowerCase() === b[i].phrase.toLowerCase() &&
      (x.gloss || '') === (b[i].gloss || '')
  );
}

function sameDeriv(a: Derivative[], b: Derivative[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (x, i) =>
      lettersKey(x.word) === lettersKey(b[i].word) &&
      (x.gloss || '') === (b[i].gloss || '') &&
      (x.pos || '') === (b[i].pos || '')
  );
}

/**
 * Merge bank lexis into a local word (categories + related fields).
 * Local items win on duplicates; bank only adds missing ones.
 * Returns null if nothing changed.
 */
export function mergeWordWithBankEntry(
  local: Word,
  entry: VocabBankEntry
): Word | null {
  const next: Word = { ...local };
  let changed = false;

  const localCats = normalizeCategories(local.category);
  const bankCats = normalizeCategories(entry.category);
  const raw = Array.isArray(local.category) ? local.category : [];
  if (localCats.length === 0 && bankCats.length) {
    next.category = bankCats;
    changed = true;
  } else if (localCats.length > 0 && localCats.join('\0') !== raw.join('\0')) {
    next.category = localCats;
    changed = true;
  }

  const synonyms = mergeRelatedWords(local.synonyms, entry.synonyms);
  if (!sameRelated(local.synonyms || [], synonyms)) {
    next.synonyms = synonyms;
    changed = true;
  }

  const similars = mergeRelatedWords(local.similars, entry.similars);
  if (!sameRelated(local.similars || [], similars)) {
    next.similars = similars;
    changed = true;
  }

  const derivatives = mergeDerivatives(local.derivatives, entry.derivatives);
  if (!sameDeriv(local.derivatives || [], derivatives)) {
    next.derivatives = derivatives;
    changed = true;
  }

  const collocations = mergeCollocations(local.collocations, entry.collocations);
  if (!sameColo(local.collocations || [], collocations)) {
    next.collocations = collocations;
    changed = true;
  }

  const dictCollocations = mergeCollocations(
    local.dictCollocations,
    entry.dictCollocations
  );
  if (!sameColo(local.dictCollocations || [], dictCollocations)) {
    next.dictCollocations = dictCollocations;
    changed = true;
  }

  // Prefer fuller bank translation when local is clearly shorter
  const bankTr = String(entry.translation || '').trim();
  const localTr = String(local.translation || '').trim();
  if (bankTr && bankTr.length >= localTr.length + 6 && bankTr !== localTr) {
    next.translation = bankTr;
    changed = true;
  }

  return changed ? next : null;
}

/** Patch all local words that appear in the bank map. */
export function patchWordsWithBankLexis(
  local: Word[],
  bankByWord: Map<string, VocabBankEntry>
): Word[] {
  const out: Word[] = [];
  for (const w of local) {
    const entry = bankByWord.get(w.word.toLowerCase());
    if (!entry) continue;
    const merged = mergeWordWithBankEntry(w, entry);
    if (merged) out.push(merged);
  }
  return out;
}

export function bankEntryMap(entries: VocabBankEntry[]): Map<string, VocabBankEntry> {
  const map = new Map<string, VocabBankEntry>();
  for (const e of entries) {
    if (!e.word) continue;
    const k = e.word.toLowerCase();
    if (!map.has(k)) map.set(k, e);
  }
  return map;
}
