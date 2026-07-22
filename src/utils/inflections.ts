/**
 * English inflection helpers — match common verb/noun variants.
 * Used for "duplicate detection" when adding words.
 */

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** Stem a verb roughly: walked→walk, running→run, studies→study */
function stemVerb(w: string): string {
  let s = w;
  // -ies → -y
  s = s.replace(/ies$/, 'y');
  // -ing / -ed → drop e if needed
  s = s.replace(/ing$/, '');
  s = s.replace(/ed$/, '');
  // double final consonant when CVC and short
  if (s.length >= 3) {
    const last = s[s.length - 1];
    const prev = s[s.length - 2];
    const before = s[s.length - 3];
    if (
      VOWELS.has(before) &&
      !VOWELS.has(prev) &&
      last === prev &&
      s.length >= 4
    ) {
      s = s.slice(0, -1);
    }
  }
  return s;
}

/** Stem a plural noun: dogs→dog, boxes→box, cities→city */
function stemNoun(w: string): string {
  let s = w;
  s = s.replace(/ies$/, 'y');
  s = s.replace(/ves$/, 'f');
  s = s.replace(/es$/, '');
  s = s.replace(/s$/, '');
  return s;
}

export function areInflectionVariants(a: string, b: string): boolean {
  if (a === b) return true;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return true;
  if (stemVerb(al) === stemVerb(bl)) return true;
  if (stemNoun(al) === stemNoun(bl)) return true;
  if (stemVerb(al) === bl || al === stemVerb(bl)) return true;
  if (stemNoun(al) === bl || al === stemNoun(bl)) return true;
  return false;
}
