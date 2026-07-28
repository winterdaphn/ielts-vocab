/**
 * Fill synonyms / similars from the built-in IELTS vocab bank
 * (prefer precomputed fields; otherwise compute in-bank matches).
 * Synonyms can be merged with AI results by callers.
 */
import ieltsVocabBank from '@/json/ielts-vocab.json';
import type { RelatedWord } from '@/types/word';

export interface VocabBankEntry {
  word: string;
  translation?: string;
  synonyms?: RelatedWord[];
  similars?: RelatedWord[];
  source?: string;
}

const bank = ieltsVocabBank as VocabBankEntry[];

function lettersOnly(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function shortGloss(translation: string | undefined): string {
  const t = String(translation || '')
    .replace(/\b(n|v|vt|vi|adj|adv|prep|conj|pron|art|num|int|aux)\.?\/?/gi, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .split(/[；;，,/、|]/)[0]
    .trim()
    .slice(0, 16);
  return t || String(translation || '').slice(0, 16);
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function isOrthographicLookAlike(a: string, b: string): boolean {
  const x = lettersOnly(a);
  const y = lettersOnly(b);
  if (!x || !y || x === y) return false;
  if (x.length < 4 || y.length < 4) return false;
  if (x.includes(y) || y.includes(x)) return false;
  const d = editDistance(x, y);
  const maxLen = Math.max(x.length, y.length);
  const lenDiff = Math.abs(x.length - y.length);
  if (d < 1 || d > 2) return false;
  if (lenDiff > 2) return false;
  if (d / maxLen > 0.4) return false;
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  let sharedPrefix = 0;
  while (sharedPrefix < shorter.length && shorter[sharedPrefix] === longer[sharedPrefix]) {
    sharedPrefix++;
  }
  let sharedSuffix = 0;
  while (
    sharedSuffix < shorter.length - sharedPrefix &&
    shorter[shorter.length - 1 - sharedSuffix] === longer[longer.length - 1 - sharedSuffix]
  ) {
    sharedSuffix++;
  }
  return sharedPrefix + sharedSuffix >= Math.min(3, shorter.length - 1);
}

const STOP_GLOSS = new Set([
  '的', '地', '得', '了', '着', '过', '和', '与', '及', '或', '等', '某', '一个', '一种',
  'vt', 'vi', 'n', 'adj', 'adv', 'prep', 'conj', 'pron', 'art', 'num', 'int', 'aux', 'v',
]);

function glossFragments(translation: string | undefined): string[] {
  const raw = String(translation || '')
    .replace(/\b(n|v|vt|vi|adj|adv|prep|conj|pron|art|num|int|aux)\.?\/?/gi, ' ')
    .replace(/[（(][^）)]*[）)]/g, ' ');
  return [
    ...new Set(
      raw
        .split(/[；;，,/、|·\s]+/)
        .map((s) => s.trim())
        .filter(
          (s) =>
            s.length >= 2 &&
            !STOP_GLOSS.has(s.toLowerCase()) &&
            !/^[a-z.]+$/i.test(s)
        )
    ),
  ];
}

function isMorphRelated(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a);
}

function fragWeight(frag: string, size: number): number {
  if (size <= 1) return 0;
  if (size > 40) return 0;
  if (size > 20) return 0.8;
  if (frag.length >= 4) return 3;
  if (frag.length >= 3) return 2.2;
  return 1.4;
}

function normalizeRelated(items: RelatedWord[] | undefined, self: string): RelatedWord[] {
  if (!Array.isArray(items)) return [];
  const selfKey = lettersOnly(self);
  const out: RelatedWord[] = [];
  for (const it of items) {
    const w = lettersOnly(it.word);
    if (!w || w === selfKey) continue;
    if (!byKey.has(w)) continue;
    if (out.some((x) => lettersOnly(x.word) === w)) continue;
    const entry = byKey.get(w)!;
    out.push({
      word: entry.word,
      gloss: (it.gloss || shortGloss(entry.translation)).slice(0, 40),
      note: '',
    });
    if (out.length >= 4) break;
  }
  return out;
}

const byKey = new Map<string, VocabBankEntry>();
for (const e of bank) {
  const k = lettersOnly(e.word);
  if (k && !byKey.has(k)) byKey.set(k, e);
}

const allKeys = [...byKey.keys()];

let inverted: Map<string, Set<string>> | null = null;
function getInverted(): Map<string, Set<string>> {
  if (inverted) return inverted;
  inverted = new Map();
  for (const [k, e] of byKey) {
    for (const frag of glossFragments(e.translation)) {
      if (!inverted.has(frag)) inverted.set(frag, new Set());
      inverted.get(frag)!.add(k);
    }
  }
  return inverted;
}

function computeSimilars(head: string): RelatedWord[] {
  const hits: { word: string; d: number }[] = [];
  for (const other of allKeys) {
    if (other === head) continue;
    if (Math.abs(other.length - head.length) > 2) continue;
    if (!isOrthographicLookAlike(head, other)) continue;
    hits.push({ word: other, d: editDistance(head, other) });
  }
  hits.sort((a, b) => a.d - b.d || a.word.localeCompare(b.word));
  return hits.slice(0, 2).map(({ word }) => {
    const e = byKey.get(word)!;
    return {
      word: e.word,
      gloss: shortGloss(e.translation),
      note: '',
    };
  });
}

function computeSynonyms(head: string, translationHint?: string): RelatedWord[] {
  const entry = byKey.get(head);
  const gloss = translationHint || entry?.translation || '';
  const inv = getInverted();
  const scores = new Map<string, number>();
  for (const frag of glossFragments(gloss)) {
    const set = inv.get(frag);
    if (!set) continue;
    const weight = fragWeight(frag, set.size);
    if (weight <= 0) continue;
    for (const other of set) {
      if (other === head) continue;
      if (isMorphRelated(head, other)) continue;
      scores.set(other, (scores.get(other) || 0) + weight);
    }
  }
  return [...scores.entries()]
    .filter(([, s]) => s >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([k]) => {
      const e = byKey.get(k)!;
      return { word: e.word, gloss: shortGloss(e.translation), note: '' };
    });
}

export function lookupBankEntry(word: string): VocabBankEntry | undefined {
  return byKey.get(lettersOnly(word));
}

/** Short Chinese gloss from bank, or empty if unknown. */
export function resolveBankGloss(word: string): { word: string; gloss: string } | null {
  const entry = lookupBankEntry(word);
  if (!entry) return null;
  return { word: entry.word, gloss: shortGloss(entry.translation) };
}

/** Merge lists; first list wins on duplicates. */
export function mergeRelatedLists(
  primary: RelatedWord[],
  secondary: RelatedWord[],
  max = 6
): RelatedWord[] {
  const out: RelatedWord[] = [];
  const seen = new Set<string>();
  for (const it of [...primary, ...secondary]) {
    const k = lettersOnly(it.word) || it.word.toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({
      word: it.word.trim(),
      gloss: String(it.gloss || '').trim().slice(0, 40),
      note: '',
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Related words from the built-in bank.
 * Similars: bank only. Synonyms: bank (AI merge is done by callers).
 */
export function getRelatedFromBank(
  word: string,
  translation?: string
): { synonyms: RelatedWord[]; similars: RelatedWord[] } {
  const key = lettersOnly(word);
  if (!key) return { synonyms: [], similars: [] };

  const entry = byKey.get(key);
  let synonyms = normalizeRelated(entry?.synonyms, word).map((it) => ({
    ...it,
    note: '',
  }));
  let similars = normalizeRelated(entry?.similars, word).map((it) => ({
    ...it,
    note: '',
  }));

  if (!synonyms.length) {
    synonyms = computeSynonyms(key, translation || entry?.translation);
  }
  if (!similars.length) {
    similars = computeSimilars(key);
  }

  return { synonyms, similars };
}
