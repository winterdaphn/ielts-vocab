export interface RelatedWord {
  /** Related English headword */
  word: string;
  /** Short Chinese gloss */
  gloss: string;
  /** Where this item came from (for UI badges) */
  source?: 'youdao' | 'ai' | 'bank' | 'manual' | 'both';
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

/** AI 近义辨析（仅本地 IndexedDB，不进云端 sync） */
export interface SynonymDiffItem {
  word: string;
  /** 语义侧重 / 语域（中文） */
  focus: string;
  /** 用法提示或典型搭配（中文，可含短英文） */
  usage: string;
  /**
   * 在给定句子里能否替换中心词。
   * 仅近义词有值；中心词本身为 undefined。
   */
  replaceOk?: boolean;
  /** 针对该句的可替换说明（中文） */
  replaceNote?: string;
}

export interface SynonymDiffResult {
  summary: string;
  items: SynonymDiffItem[];
  contrasts: string[];
  /** 做替换判断时用的句子（可选） */
  sentence?: string;
}

/** Persisted cache: result + fingerprint of headword + synonyms + sentence */
export interface StoredSynonymDiff extends SynonymDiffResult {
  /** head|peers|sentence — invalidate when近义或句子变化 */
  key: string;
}

export interface Word {
  /** Primary key — canonical lowercase lemma (same as route /words/:id). */
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
  /**
   * AI 近义用法辨析缓存。只存本机 DB，wordToSyncPatch 不会上传。
   */
  synonymDiff?: StoredSynonymDiff;
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
  /** Last local/remote mutation time (ms); used for LWW sync */
  updatedAt?: number;
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
