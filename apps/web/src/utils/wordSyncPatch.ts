/**
 * Compact cloud sync patches — only user overlays + SRS, not bank lexemes.
 *
 * Push: diff local words against vocab bank; skip untouched bank copies.
 * Pull: merge patches into existing local rows (never wipe the whole list).
 *
 * Local-only fields (never uploaded): synonymDiff (AI 近义辨析缓存).
 */

import type { Word, RelatedWord, Collocation } from '@/types/word';
import { allVocabBank, type VocabBankEntry } from '@/json/vocab';
import { normalizeCategories } from '@/config/categories';
import { makeNewWord } from '@/store/useWords';
import { wordToId, withCanonicalWordId } from '@/utils/wordId';
import {
  mergeCollocations,
  mergeDerivatives,
  mergeRelatedWords,
} from '@/utils/mergeBankLexis';

export const SYNC_FORMAT_VERSION = 3;

/** Compact related item in sync JSON */
export type SyncRelated = { w: string; g: string; s?: string };
/** Compact collocation in sync JSON */
export type SyncColo = { p: string; g: string };

/**
 * Per-word overlay. Only set fields that differ from bank / defaults.
 * Short keys keep gzip payload small.
 */
export interface WordSyncPatch {
  /** Headword spelling as stored locally; merge key is wordToId(w). */
  w: string;
  /** mnemonic / 笔记 */
  m?: string;
  syn?: SyncRelated[];
  sim?: SyncRelated[];
  /** 固定搭配（手记 / LLM），不含词典 dictCollocations */
  col?: SyncColo[];
  cat?: string[];
  star?: boolean;
  /** crossedOut */
  x?: boolean;
  ease?: number;
  /** interval (days) */
  iv?: number;
  /** streak */
  st?: number;
  /** nextReview timestamp */
  nr?: number;
  tr?: number;
  cr?: number;
  /** createdAt */
  ca?: number;
}

/** Word not found in built-in bank — needs base fields to recreate on another device */
export interface CustomWordSync extends WordSyncPatch {
  custom: true;
  trl?: string;
  pus?: string;
  puk?: string;
  pos?: string;
  /** derivatives */
  der?: Array<{ w: string; g: string; pos?: string }>;
  /** dictCollocations */
  dcol?: SyncColo[];
}

export function lettersKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

let bankMapCache: Map<string, VocabBankEntry> | null = null;

function mergeBankEntries(
  a: VocabBankEntry,
  b: VocabBankEntry
): VocabBankEntry {
  const pickTr =
    String(a.translation || '').length >= String(b.translation || '').length
      ? a.translation
      : b.translation;
  return {
    ...a,
    word: a.word || b.word,
    translation: pickTr || a.translation || b.translation,
    synonyms: mergeRelatedWords(a.synonyms, b.synonyms, 12),
    similars: mergeRelatedWords(a.similars, b.similars, 12),
    collocations: mergeCollocations(a.collocations, b.collocations, 16),
    derivatives: mergeDerivatives(a.derivatives, b.derivatives, 12),
    dictCollocations: mergeCollocations(
      a.dictCollocations,
      b.dictCollocations,
      16
    ),
    category:
      (Array.isArray(a.category) && a.category.length
        ? a.category
        : b.category) || a.category,
  };
}

export function getBankMap(): Map<string, VocabBankEntry> {
  if (bankMapCache) return bankMapCache;
  const m = new Map<string, VocabBankEntry>();
  for (const e of allVocabBank) {
    const k = lettersKey(e.word);
    if (!k) continue;
    const prev = m.get(k);
    m.set(k, prev ? mergeBankEntries(prev, e) : e);
  }
  bankMapCache = m;
  return m;
}

/** True if headword is not in the built-in IELTS/kaoyan bank (hand-added). */
export function isCustomWord(word: string, bank = getBankMap()): boolean {
  const k = lettersKey(word);
  return !!k && !bank.has(k);
}

function packRelated(list: RelatedWord[] | undefined): SyncRelated[] {
  return (list || [])
    .map((it) => ({
      w: String(it.word || '').trim(),
      g: String(it.gloss || '').trim().slice(0, 40),
      ...(it.source ? { s: it.source } : {}),
    }))
    .filter((it) => it.w);
}

function unpackRelated(list: SyncRelated[] | undefined): RelatedWord[] {
  const allowed = new Set(['youdao', 'ai', 'bank', 'manual', 'both']);
  return (list || [])
    .map((it) => {
      const source = String(it.s || '');
      return {
        word: String(it.w || '').trim(),
        gloss: String(it.g || '').trim().slice(0, 40),
        ...(allowed.has(source)
          ? { source: source as RelatedWord['source'] }
          : {}),
      };
    })
    .filter((it) => it.word);
}

function packColo(list: Collocation[] | undefined): SyncColo[] {
  return (list || [])
    .map((it) => ({
      p: String(it.phrase || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      g: String(it.gloss || '').trim().slice(0, 40),
    }))
    .filter((it) => it.p);
}

function unpackColo(list: SyncColo[] | undefined): Collocation[] {
  return (list || [])
    .map((it) => ({
      phrase: String(it.p || '').trim(),
      gloss: String(it.g || '').trim().slice(0, 40),
    }))
    .filter((it) => it.phrase);
}

function relatedLemmaSetEqual(
  a: RelatedWord[] | undefined,
  b: RelatedWord[] | undefined
): boolean {
  const sa = new Set<string>();
  const sb = new Set<string>();
  for (const it of a || []) {
    const k = lettersKey(it.word);
    if (k) sa.add(k);
  }
  for (const it of b || []) {
    const k = lettersKey(it.word);
    if (k) sb.add(k);
  }
  if (sa.size !== sb.size) return false;
  for (const k of sa) if (!sb.has(k)) return false;
  return true;
}

function coloPhraseSetEqual(
  a: Collocation[] | undefined,
  b: Collocation[] | undefined
): boolean {
  const sa = new Set(packColo(a).map((x) => x.p.toLowerCase()));
  const sb = new Set(packColo(b).map((x) => x.p.toLowerCase()));
  if (sa.size !== sb.size) return false;
  for (const p of sa) if (!sb.has(p)) return false;
  return true;
}

function catsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const na = normalizeCategories(a).slice().sort();
  const nb = normalizeCategories(b).slice().sort();
  if (na.length !== nb.length) return false;
  return na.every((x, i) => x === nb[i]);
}

function hasLearningProgress(w: Word): boolean {
  return (
    !!w.crossedOut ||
    !!w.starred ||
    (w.totalReviews || 0) > 0 ||
    (w.correctReviews || 0) > 0 ||
    (w.streak || 0) > 0 ||
    (w.interval || 0) > 0 ||
    (typeof w.ease === 'number' && w.ease !== 2.5)
  );
}

function bankCats(entry: VocabBankEntry | undefined): string[] {
  if (!entry) return [];
  return normalizeCategories(
    Array.isArray(entry.category)
      ? entry.category
      : entry.category
        ? [String(entry.category)]
        : []
  );
}

/**
 * Build a compact patch for one local word.
 * Returns null if there is nothing beyond bank defaults to sync.
 */
export function wordToSyncPatch(
  w: Word,
  bank = getBankMap()
): WordSyncPatch | CustomWordSync | null {
  const key = lettersKey(w.word);
  if (!key) return null;
  const entry = bank.get(key);
  const isCustom = !entry;

  const patch: WordSyncPatch = { w: w.word.trim() };

  const mnemonic = String(w.mnemonic || '').trim();
  if (mnemonic) patch.m = mnemonic.slice(0, 500);

  if (!relatedLemmaSetEqual(w.synonyms, entry?.synonyms)) {
    patch.syn = packRelated(w.synonyms);
  }
  if (!relatedLemmaSetEqual(w.similars, entry?.similars)) {
    patch.sim = packRelated(w.similars);
  }
  if (!coloPhraseSetEqual(w.collocations, entry?.collocations)) {
    patch.col = packColo(w.collocations);
  }
  if (!catsEqual(w.category, bankCats(entry))) {
    patch.cat = normalizeCategories(w.category);
  }

  if (w.starred) patch.star = true;
  if (w.crossedOut) patch.x = true;

  if (hasLearningProgress(w)) {
    if (typeof w.ease === 'number') patch.ease = w.ease;
    if (w.interval) patch.iv = w.interval;
    if (w.streak) patch.st = w.streak;
    if (w.nextReview) patch.nr = w.nextReview;
    if (w.totalReviews) patch.tr = w.totalReviews;
    if (w.correctReviews) patch.cr = w.correctReviews;
  }

  const hasOverlay =
    patch.m !== undefined ||
    patch.syn !== undefined ||
    patch.sim !== undefined ||
    patch.col !== undefined ||
    patch.cat !== undefined ||
    patch.star !== undefined ||
    patch.x !== undefined ||
    patch.tr !== undefined ||
    patch.iv !== undefined ||
    patch.st !== undefined ||
    patch.nr !== undefined ||
    patch.ease !== undefined;

  if (isCustom) {
    return {
      ...patch,
      custom: true,
      trl: (w.translation || '').trim().slice(0, 200),
      pus: w.phoneticUs || '',
      puk: w.phoneticUk || '',
      pos: w.partOfSpeech || '',
      der: (w.derivatives || [])
        .map((d) => ({
          w: String(d.word || '').trim(),
          g: String(d.gloss || '').trim().slice(0, 40),
          ...(d.pos ? { pos: String(d.pos).trim() } : {}),
        }))
        .filter((d) => d.w)
        .slice(0, 12),
      dcol: packColo(w.dictCollocations).slice(0, 12),
    };
  }

  return hasOverlay ? patch : null;
}

export function buildSyncPatches(words: Word[]): {
  patches: WordSyncPatch[];
  custom: CustomWordSync[];
} {
  const bank = getBankMap();
  const patches: WordSyncPatch[] = [];
  const custom: CustomWordSync[] = [];
  for (const w of words) {
    const p = wordToSyncPatch(w, bank);
    if (!p) continue;
    if ('custom' in p && p.custom) custom.push(p);
    else patches.push(p);
  }
  return { patches, custom };
}

function applyPatchFields(local: Word, patch: WordSyncPatch): Word {
  const next: Word = { ...local };
  if (patch.m !== undefined) next.mnemonic = patch.m;
  if (patch.syn !== undefined) next.synonyms = unpackRelated(patch.syn);
  if (patch.sim !== undefined) next.similars = unpackRelated(patch.sim);
  if (patch.col !== undefined) next.collocations = unpackColo(patch.col);
  if (patch.cat !== undefined) next.category = normalizeCategories(patch.cat);
  if (patch.star !== undefined) next.starred = !!patch.star;
  if (patch.x !== undefined) next.crossedOut = !!patch.x;
  if (patch.ease !== undefined) next.ease = patch.ease;
  if (patch.iv !== undefined) next.interval = patch.iv;
  if (patch.st !== undefined) next.streak = patch.st;
  if (patch.nr !== undefined) next.nextReview = patch.nr;
  if (patch.tr !== undefined) next.totalReviews = patch.tr;
  if (patch.cr !== undefined) next.correctReviews = patch.cr;
  if (patch.ca !== undefined) next.createdAt = patch.ca;
  return next;
}

function customToWord(c: CustomWordSync): Word {
  const base = makeNewWord({
    word: c.w,
    translation: c.trl || '',
    phoneticUs: c.pus || '',
    phoneticUk: c.puk || '',
    partOfSpeech: c.pos || '',
    examples: [],
    derivatives: (c.der || [])
      .map((d) => ({
        word: String(d.w || '').trim(),
        gloss: String(d.g || '').trim().slice(0, 40),
        ...(d.pos ? { pos: String(d.pos).trim() } : {}),
      }))
      .filter((d) => d.word),
    dictCollocations: unpackColo(c.dcol),
  });
  return applyPatchFields(base, c);
}

/**
 * Merge cloud patches into the current local word list.
 * Does not remove local words that are absent from the cloud.
 */
export function mergeSyncIntoWords(
  localWords: Word[],
  patches: WordSyncPatch[],
  customs: CustomWordSync[]
): { words: Word[]; patched: number; added: number } {
  const byId = new Map<string, number>();
  const byKey = new Map<string, number>();
  const out = localWords.map((w) => ({ ...w }));
  out.forEach((w, i) => {
    if (w.id) byId.set(w.id, i);
    const k = lettersKey(w.word);
    if (k && !byKey.has(k)) byKey.set(k, i);
  });

  let patched = 0;
  let added = 0;

  const applyOne = (patch: WordSyncPatch, createIfMissing: () => Word | null) => {
    let idx = -1;
    const canonId = wordToId(patch.w);
    if (canonId && byId.has(canonId)) {
      idx = byId.get(canonId)!;
    } else {
      const k = lettersKey(patch.w);
      if (k && byKey.has(k)) idx = byKey.get(k)!;
    }
    if (idx >= 0) {
      out[idx] = withCanonicalWordId(applyPatchFields(out[idx], patch));
      patched++;
      return;
    }
    const created = createIfMissing();
    if (!created) return;
    const next = withCanonicalWordId(applyPatchFields(created, patch));
    idx = out.length;
    out.push(next);
    if (next.id) byId.set(next.id, idx);
    const k = lettersKey(next.word);
    if (k) byKey.set(k, idx);
    added++;
  };

  for (const p of patches) {
    applyOne(p, () => {
      // Bank word missing locally — create a minimal shell so progress can attach.
      // Learner should import bank for full translation / bank lexis.
      const entry = getBankMap().get(lettersKey(p.w));
      if (entry) {
        return makeNewWord({
          word: entry.word || p.w,
          translation: entry.translation || '',
          phoneticUs: entry.phoneticUs || '',
          phoneticUk: entry.phoneticUk || '',
          partOfSpeech: entry.pos || '',
          category: bankCats(entry),
          synonyms: entry.synonyms || [],
          similars: entry.similars || [],
          derivatives: entry.derivatives || [],
          collocations: entry.collocations || [],
          dictCollocations: entry.dictCollocations || [],
          examples: [],
        });
      }
      return makeNewWord({
        word: p.w,
        translation: '',
        examples: [],
      });
    });
  }

  for (const c of customs) {
    applyOne(c, () => customToWord(c));
  }

  return { words: out, patched, added };
}
