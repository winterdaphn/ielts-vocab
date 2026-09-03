import type { MutableRefObject } from 'react';
import { generatePracticeBatch } from '@/api/llm';
import { syncCloudItemExample } from '@/api/practiceCloudSync';
import { isNew } from '@/utils/scheduler';
import type { SentenceDifficulty } from '@/utils/practiceSession';
import {
  exampleFromCache,
  llmGenMode,
  type Mode,
  type Question,
} from '@/utils/practiceSelect';
import type { Settings } from '@/types/settings';
import type { Word } from '@/types/word';
import { isAbortError } from './helpers';
import { PREFETCH_AHEAD, PREFETCH_BATCH } from './types';

export interface GenerationRefs {
  sessionIdRef: MutableRefObject<number>;
  inflightRef: MutableRefObject<Set<string>>;
  prefetchFailedRef: MutableRefObject<Set<string>>;
  queueRef: MutableRefObject<(Question | null)[]>;
  abortRef: MutableRefObject<AbortController | null>;
  cloudPracticeSessionIdRef: MutableRefObject<string | null>;
  difficultyRef: MutableRefObject<SentenceDifficulty>;
  wasNewRef: MutableRefObject<Map<string, boolean>>;
  prefetchRunningRef: MutableRefObject<boolean>;
  prefetchFromRef: MutableRefObject<number>;
}

export function toQuestion(
  refs: Pick<GenerationRefs, 'difficultyRef' | 'wasNewRef'>,
  word: Word,
  sentence: { en: string; zh: string; source?: Question['source'] },
  m: Mode,
  pool: Word[]
): Question {
  const distractors = pool.filter((w) => w.id !== word.id).map((w) => w.word);
  const source = sentence.source || 'llm';
  if (typeof console !== 'undefined') {
    console.info(`[practice] ${word.word} ← ${source}`);
  }
  return {
    word,
    example: {
      ...exampleFromCache(word, sentence, m, distractors),
      difficulty: refs.difficultyRef.current,
    },
    source,
    wasNew: refs.wasNewRef.current.get(word.id) ?? isNew(word),
  };
}

/** Returns error message if generation failed hard (API / parse). */
export async function fillBatch(
  refs: GenerationRefs,
  settings: Settings,
  setQueue: (next: (Question | null)[]) => void,
  setGenError: (msg: string) => void,
  sid: number,
  list: Word[],
  m: Mode,
  pool: Word[]
): Promise<string> {
  const todo = list.filter(
    (w) =>
      !refs.inflightRef.current.has(w.id) &&
      !refs.prefetchFailedRef.current.has(w.id) &&
      !refs.queueRef.current[pool.findIndex((x) => x.id === w.id)]
  );
  if (!todo.length) return '';
  todo.forEach((w) => refs.inflightRef.current.add(w.id));

  try {
    const signal = refs.abortRef.current?.signal;
    const map = await generatePracticeBatch(todo, llmGenMode(m), settings, {
      difficulty: refs.difficultyRef.current,
      signal,
      noRetry: todo.length > 1,
    });
    if (refs.sessionIdRef.current !== sid) return '';

    const next = [...refs.queueRef.current];
    for (const w of todo) {
      const i = pool.findIndex((x) => x.id === w.id);
      if (i < 0 || next[i] || !map[w.id]) continue;
      next[i] = toQuestion(refs, w, map[w.id], m, pool);
    }
    refs.queueRef.current = next;
    setQueue(next);

    const cloudId = refs.cloudPracticeSessionIdRef.current;
    if (cloudId) {
      for (const w of todo) {
        const i = pool.findIndex((x) => x.id === w.id);
        const q = next[i];
        if (i >= 0 && q?.example) {
          syncCloudItemExample(cloudId, i, q.example, !!q.wasNew);
        }
      }
    }

    const failed = todo.filter((w) => !map[w.id]);
    for (const w of failed) refs.prefetchFailedRef.current.add(w.id);
    if (failed.length) {
      console.warn('[practice] fillBatch missing', failed.map((w) => w.word).join(', '));
    }
    if (failed.length === todo.length) {
      return '模型返回的句子未通过校验（过短/过长或模板句），请重试';
    }
    return '';
  } catch (e) {
    if (isAbortError(e) || refs.sessionIdRef.current !== sid) return '';
    console.warn('[practice] fillBatch error', e);
    for (const w of todo) refs.prefetchFailedRef.current.add(w.id);
    const msg =
      e instanceof Error && e.message
        ? e.message
        : '出题失败，请检查 API Key / 网络后重试';
    if (refs.sessionIdRef.current === sid) setGenError(msg);
    return msg;
  } finally {
    todo.forEach((w) => refs.inflightRef.current.delete(w.id));
  }
}

export function kickPrefetch(
  refs: GenerationRefs,
  settings: Settings,
  setQueue: (next: (Question | null)[]) => void,
  setGenError: (msg: string) => void,
  sid: number,
  pool: Word[],
  m: Mode,
  fromIdx: number
) {
  refs.prefetchFromRef.current = fromIdx;
  if (refs.prefetchRunningRef.current) return;
  if (refs.sessionIdRef.current !== sid) return;
  refs.prefetchRunningRef.current = true;
  void (async () => {
    try {
      let idleRounds = 0;
      while (refs.sessionIdRef.current === sid) {
        const start = refs.prefetchFromRef.current;
        const missing: Word[] = [];
        const end = Math.min(pool.length, start + PREFETCH_AHEAD);
        for (let i = start; i < end && missing.length < PREFETCH_BATCH; i++) {
          const w = pool[i];
          if (
            !refs.queueRef.current[i] &&
            !refs.inflightRef.current.has(w.id) &&
            !refs.prefetchFailedRef.current.has(w.id)
          ) {
            missing.push(w);
          }
        }
        if (!missing.length) break;

        const filledBefore = missing.filter((w) => {
          const i = pool.findIndex((x) => x.id === w.id);
          return i >= 0 && !!refs.queueRef.current[i];
        }).length;

        await fillBatch(refs, settings, setQueue, setGenError, sid, missing, m, pool);
        if (refs.sessionIdRef.current !== sid) break;

        const filledAfter = missing.filter((w) => {
          const i = pool.findIndex((x) => x.id === w.id);
          return i >= 0 && !!refs.queueRef.current[i];
        }).length;

        if (filledAfter <= filledBefore) {
          idleRounds += 1;
          if (idleRounds >= 1) break;
        } else {
          idleRounds = 0;
        }
      }
    } finally {
      refs.prefetchRunningRef.current = false;
      if (refs.sessionIdRef.current === sid) {
        const start = refs.prefetchFromRef.current;
        const end = Math.min(pool.length, start + PREFETCH_AHEAD);
        const stillNeed = pool.slice(start, end).some((w, j) => {
          const i = start + j;
          return (
            !refs.queueRef.current[i] &&
            !refs.inflightRef.current.has(w.id) &&
            !refs.prefetchFailedRef.current.has(w.id)
          );
        });
        if (stillNeed) {
          kickPrefetch(refs, settings, setQueue, setGenError, sid, pool, m, start);
        }
      }
    }
  })();
}
