import type { Word } from '@/types/word';

/** Canonical primary key — lowercase lemma (hyphens kept). */
export function wordToId(word: string): string {
  return String(word || '').trim().toLowerCase();
}

export function encodeWordRouteId(id: string): string {
  return encodeURIComponent(id);
}

export function decodeWordRouteId(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function wordDetailPath(wordOrId: string | Word): string {
  const id =
    typeof wordOrId === 'string'
      ? wordToId(wordOrId)
      : wordOrId.id || wordToId(wordOrId.word);
  return `/words/${encodeWordRouteId(id)}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLegacyWordUuid(id: string): boolean {
  return UUID_RE.test(String(id || '').trim());
}

/** Ensure Word.id matches lemma; does not merge duplicates. */
export function withCanonicalWordId<T extends Word>(w: T): T {
  const id = wordToId(w.word);
  if (!id) return w;
  return w.id === id ? w : { ...w, id };
}

function mergeByWordField<T extends { word: string }>(a: T[] | undefined, b: T[] | undefined): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of [...(a || []), ...(b || [])]) {
    const k = wordToId(it.word);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function mergeCollocations(
  a: Word['collocations'],
  b: Word['collocations']
): Word['collocations'] {
  const seen = new Set<string>();
  const out: NonNullable<Word['collocations']> = [];
  for (const it of [...(a || []), ...(b || [])]) {
    const k = String(it.phrase || '').toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/** Merge two rows for the same lemma (migration / dedupe). */
export function mergeWordRecords(a: Word, b: Word): Word {
  const prefer =
    a.totalReviews >= b.totalReviews
      ? a
      : b.totalReviews > a.totalReviews
        ? b
        : a.createdAt <= b.createdAt
          ? a
          : b;
  const other = prefer === a ? b : a;
  const word = prefer.word || other.word;
  const id = wordToId(word);
  return withCanonicalWordId({
    ...prefer,
    ...other,
    id,
    word,
    translation: prefer.translation || other.translation,
    mnemonic:
      String(prefer.mnemonic || '').length >= String(other.mnemonic || '').length
        ? prefer.mnemonic
        : other.mnemonic,
    starred: prefer.starred || other.starred,
    crossedOut: prefer.crossedOut || other.crossedOut,
    ease: Math.max(prefer.ease ?? 2.5, other.ease ?? 2.5),
    interval: Math.max(prefer.interval || 0, other.interval || 0),
    streak: Math.max(prefer.streak || 0, other.streak || 0),
    nextReview: Math.min(
      prefer.nextReview || Date.now(),
      other.nextReview || Date.now()
    ),
    totalReviews: Math.max(prefer.totalReviews || 0, other.totalReviews || 0),
    correctReviews: Math.max(prefer.correctReviews || 0, other.correctReviews || 0),
    createdAt: Math.min(prefer.createdAt || Date.now(), other.createdAt || Date.now()),
    synonyms: mergeByWordField(prefer.synonyms, other.synonyms),
    similars: mergeByWordField(prefer.similars, other.similars),
    derivatives: mergeByWordField(prefer.derivatives, other.derivatives),
    collocations: mergeCollocations(prefer.collocations, other.collocations),
    dictCollocations: mergeCollocations(prefer.dictCollocations, other.dictCollocations),
    examples: prefer.examples?.length ? prefer.examples : other.examples || [],
    synonymDiff: prefer.synonymDiff?.key ? prefer.synonymDiff : other.synonymDiff,
    category:
      (prefer.category?.length ? prefer.category : other.category) || [],
  });
}

export function findWordIndex(words: Word[], routeSegment: string): number {
  const key = decodeWordRouteId(routeSegment);
  if (!key) return -1;
  const idx = words.findIndex((w) => w.id === key || wordToId(w.word) === key);
  return idx;
}
