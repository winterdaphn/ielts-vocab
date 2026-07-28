export interface RelatedWord {
  /** Related English headword */
  word: string;
  /** Short Chinese gloss */
  gloss: string;
  /** Contrast / usage note in Chinese (≤30 chars preferred) */
  note: string;
}

export interface Word {
  id: string;
  word: string;
  translation: string;
  phonetic?: string;
  partOfSpeech?: string;
  mnemonic?: string;
  /** Near-synonyms for richer expression */
  synonyms?: RelatedWord[];
  /** Orthographic look-alikes only (形近词), not sound-alikes or semantic near-misses */
  similars?: RelatedWord[];
  examples: WordExample[];
  crossedOut: boolean;
  ease: number;
  interval: number;
  streak: number;
  nextReview: number;  // timestamp
  totalReviews: number;
  correctReviews: number;
  createdAt: number;
}

export interface WordExample {
  en: string;
  zh: string;
  blank?: string;          // the cloze target word
  highlighted?: string;    // pre-formatted HTML with <mark>
  choiceA?: string;        // 4 multiple choice options
  choiceB?: string;
  choiceC?: string;
  choiceD?: string;
  answer?: 'A' | 'B' | 'C' | 'D';
  explanation?: string;
}

export type PracticeMode = 'cloze' | 'translate';
