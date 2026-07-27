/**
 * English inflection helpers — match common verb/noun variants.
 * Used for duplicate detection and cloze sentence acceptance.
 */

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** Collect comparable stems so embracing ↔ embraced ↔ embrace share a key. */
function verbStemKeys(w: string): Set<string> {
  const s = w.toLowerCase();
  const keys = new Set<string>([s]);

  let stem = s;
  if (/ies$/.test(stem)) stem = stem.replace(/ies$/, 'y');
  else if (/ing$/.test(stem) && stem.length > 4) stem = stem.slice(0, -3);
  else if (/ed$/.test(stem) && stem.length > 3) stem = stem.slice(0, -2);
  else if (/es$/.test(stem) && stem.length > 3) stem = stem.slice(0, -2);
  else if (/s$/.test(stem) && stem.length > 3 && !/ss$/.test(stem)) stem = stem.slice(0, -1);

  // running → runn → run
  if (stem.length >= 3) {
    const last = stem[stem.length - 1];
    const prev = stem[stem.length - 2];
    const before = stem[stem.length - 3];
    if (
      VOWELS.has(before) &&
      !VOWELS.has(prev) &&
      last === prev
    ) {
      stem = stem.slice(0, -1);
    }
  }

  keys.add(stem);
  // silent -e: embrac ↔ embrace
  if (stem.endsWith('e')) keys.add(stem.slice(0, -1));
  else keys.add(stem + 'e');

  return keys;
}

/** Stem a plural noun: dogs→dog, boxes→box, cities→city */
function stemNoun(w: string): string {
  let s = w.toLowerCase();
  s = s.replace(/ies$/, 'y');
  s = s.replace(/ves$/, 'f');
  if (/xes$|ches$|shes$|sses$|zes$/.test(s)) s = s.replace(/es$/, '');
  else s = s.replace(/s$/, '');
  return s;
}

export function areInflectionVariants(a: string, b: string): boolean {
  if (!a || !b) return false;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return true;

  const va = verbStemKeys(al);
  for (const k of verbStemKeys(bl)) {
    if (va.has(k)) return true;
  }

  if (stemNoun(al) === stemNoun(bl)) return true;
  if (stemNoun(al) === bl || al === stemNoun(bl)) return true;
  return false;
}

/** Find the token in `sentence` that matches `word` (incl. inflections). */
export function findInflectedFormInSentence(sentence: string, word: string): string | null {
  const w = word.trim();
  if (!w || !sentence) return null;
  const tokens = sentence.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  for (const t of tokens) {
    if (areInflectionVariants(t, w)) return t;
  }
  return null;
}

export function sentenceContainsWordForm(sentence: string, word: string): boolean {
  return !!findInflectedFormInSentence(sentence, word);
}
