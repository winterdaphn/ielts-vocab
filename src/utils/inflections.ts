/**
 * English inflection helpers — lemma guess + duplicate detection.
 */

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** Common irregular forms → base lemma */
const IRREGULAR_LEMMA: Record<string, string> = {
  am: 'be',
  is: 'be',
  are: 'be',
  was: 'be',
  were: 'be',
  been: 'be',
  being: 'be',
  has: 'have',
  had: 'have',
  having: 'have',
  does: 'do',
  did: 'do',
  done: 'do',
  doing: 'do',
  goes: 'go',
  went: 'go',
  gone: 'go',
  going: 'go',
  children: 'child',
  men: 'man',
  women: 'woman',
  mice: 'mouse',
  teeth: 'tooth',
  feet: 'foot',
  geese: 'goose',
  leaves: 'leaf',
  knives: 'knife',
  wives: 'wife',
  lives: 'life',
  better: 'good',
  best: 'good',
  worse: 'bad',
  worst: 'bad',
  less: 'little',
  least: 'little',
  more: 'much',
  most: 'much',
};

/** Stem a verb roughly: walked→walk, running→run, studies→study */
function stemVerb(w: string): string {
  let s = w;
  s = s.replace(/ies$/, 'y');
  s = s.replace(/ing$/, '');
  s = s.replace(/ed$/, '');
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
  const la = guessLemma(al);
  const lb = guessLemma(bl);
  if (la === lb) return true;
  if (stemVerb(al) === stemVerb(bl)) return true;
  if (stemNoun(al) === stemNoun(bl)) return true;
  if (stemVerb(al) === bl || al === stemVerb(bl)) return true;
  if (stemNoun(al) === bl || al === stemNoun(bl)) return true;
  return false;
}

/**
 * Best-effort local lemma (no AI). Prefer AI `lookupWordInfo().lemma` when available.
 * Examples: ingredients→ingredient, possesses→possess, running→run, studied→study
 */
export function guessLemma(raw: string): string {
  const w = String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z'-]/g, '');
  if (!w) return '';
  if (IRREGULAR_LEMMA[w]) return IRREGULAR_LEMMA[w];
  if (w.length < 4) return w;

  // -ies → -y (cities, studies, carries)
  if (/[b-df-hj-np-tv-z]ies$/i.test(w) && w.length > 4) {
    return w.slice(0, -3) + 'y';
  }

  // -ves → -f / -fe (leaves→leaf handled in irregular; knives)
  if (/ves$/i.test(w) && w.length > 4) {
    const base = w.slice(0, -3);
    if (/[i]$/i.test(base)) return base + 'fe'; // knives → knife
    return base + 'f';
  }

  // -sses / -ches / -xes / -zes / -shes → drop -es (possesses→possess, watches→watch)
  if (/(sses|ches|xes|zes|shes)$/i.test(w) && w.length > 5) {
    return w.slice(0, -2);
  }

  // -oes → -o (potatoes→potato)
  if (/[bcdfghjklmnpqrstvwxyz]oes$/i.test(w) && w.length > 4) {
    return w.slice(0, -2);
  }

  // -ying → -y (studying→study, carrying→carry)
  if (/ying$/i.test(w) && w.length > 5) {
    return w.slice(0, -3);
  }

  // -ing
  if (/ing$/i.test(w) && w.length > 5) {
    let s = w.slice(0, -3);
    // running → runn → run
    if (
      s.length >= 2 &&
      s[s.length - 1] === s[s.length - 2] &&
      !VOWELS.has(s[s.length - 1])
    ) {
      return s.slice(0, -1);
    }
    // Local heuristic: strip only. Prefer AI lemma for make/hope-type verbs.
    return s;
  }

  // -ied → -y (studied→study)
  if (/ied$/i.test(w) && w.length > 4) {
    return w.slice(0, -3) + 'y';
  }

  // -ed
  if (/ed$/i.test(w) && w.length > 4) {
    let s = w.slice(0, -2);
    // stopped → stopp → stop
    if (
      s.length >= 2 &&
      s[s.length - 1] === s[s.length - 2] &&
      !VOWELS.has(s[s.length - 1])
    ) {
      return s.slice(0, -1);
    }
    // Local heuristic: strip only. Prefer AI lemma for like/hope-type verbs.
    return s;
  }

  // -es (boxes→box, wishes→wish) — after special cases above
  if (/es$/i.test(w) && w.length > 4) {
    return w.slice(0, -2);
  }

  // plain plural -s (ingredients→ingredient), not ss / us
  if (/[b-df-hj-np-tv-z]s$/i.test(w) && !/(ss|us|is|os)$/i.test(w) && w.length > 3) {
    return w.slice(0, -1);
  }

  return w;
}

/** Normalize a candidate lemma from AI: lowercase, letters only, fallback to guess. */
export function resolveLemma(input: string, aiLemma?: string | null): string {
  const raw = String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z'-]/g, '');
  const fromAi = String(aiLemma || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z'-]/g, '');
  if (fromAi && /^[a-z][a-z'-]*$/.test(fromAi) && fromAi.length >= 2) {
    return fromAi;
  }
  return guessLemma(raw) || raw;
}
