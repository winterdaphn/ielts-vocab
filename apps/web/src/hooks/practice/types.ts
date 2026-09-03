import type { SentenceStructureAnalysis, TranslateHints } from '@/api/llm';
import type { Derivative, RelatedWord } from '@/types/word';

export type Phase = 'selecting' | 'loading' | 'asking' | 'judging' | 'waiting' | 'done';

export type JudgeResult = {
  score?: number;
  correct: boolean;
  feedback: string;
  improved?: string;
  expected?: string;
  wordCompare?: string;
  usageTip?: string;
  grammarTip?: string;
  /** 未作答，直接揭晓 */
  revealed?: boolean;
} | null;

export type CardSnapshot = {
  showAnswer: boolean;
  picked: string | null;
  judgeResult: JudgeResult;
  hintShown: boolean;
  translateHintLevel: number;
  translateHints: TranslateHints | null;
  mnemonicTip?: string;
  mnemonicLoading?: boolean;
  synonymsTip?: RelatedWord[];
  similarsTip?: RelatedWord[];
  derivativesTip?: Derivative[];
  relatedLoading?: boolean;
  structureTip?: SentenceStructureAnalysis | null;
  structureLoading?: boolean;
};

export type AttemptRecord = {
  picked: string | null;
  judgeResult: JudgeResult;
  correct: boolean;
};

/** 练习结束页：本轮各题结果 */
export type SessionReviewItem = {
  word: string;
  translation?: string;
  correct: boolean | null;
};

/** Start after 1 ready; small background batches keep the queue warm without long waits */
export const PREFETCH_INITIAL = 1;
export const PREFETCH_BATCH = 3;
export const PREFETCH_AHEAD = 5;
