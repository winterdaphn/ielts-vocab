export interface RelatedWord {
  /** Related English headword */
  word: string;
  /** Short Chinese gloss */
  gloss: string;
}

/** Word-family derivative / cognate, e.g. decide → decision */
export interface Derivative {
  word: string;
  gloss: string;
  /** Part of speech from dictionary, e.g. n. / adj. */
  pos?: string;
}

/** Fixed collocation / chunk, e.g. "feel elated" */
export interface Collocation {
  /** English phrase containing the headword */
  phrase: string;
  /** Short Chinese gloss */
  gloss: string;
}

export interface Word {
  id: string;
  word: string;
  translation: string;
  /** @deprecated legacy single IPA; prefer phoneticUs / phoneticUk. Kept for old sync data. */
  phonetic?: string;
  /** US IPA, e.g. /ˈdætə/ */
  phoneticUs?: string;
  /** UK IPA, e.g. /ˈdeɪtə/ */
  phoneticUk?: string;
  partOfSpeech?: string;
  mnemonic?: string;
  /** 主题分组（真经预置 + 自定义），如 ["01_自然地理"] */
  category?: string[];
  /** Near-synonyms for richer expression */
  synonyms?: RelatedWord[];
  /** Orthographic look-alikes only (形近词), not sound-alikes or semantic near-misses */
  similars?: RelatedWord[];
  /** Same-family derivatives (派生/同根词), e.g. decide → decision */
  derivatives?: Derivative[];
  /** LLM / 手记固定搭配 */
  collocations?: Collocation[];
  /** 词典（有道 phrs）固定搭配，与 collocations 分开存、分开展示 */
  dictCollocations?: Collocation[];
  examples: WordExample[];
  crossedOut: boolean;
  /** 星标：方便单独复习的重点词 */
  starred?: boolean;
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
