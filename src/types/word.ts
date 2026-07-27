export interface Word {
  id: string;
  word: string;
  translation: string;
  phonetic?: string;
  /** US IPA, e.g. /ˈdætə/ */
  phoneticUs?: string;
  /** UK IPA, e.g. /ˈdeɪtə/ */
  phoneticUk?: string;
  partOfSpeech?: string;
  mnemonic?: string;
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
