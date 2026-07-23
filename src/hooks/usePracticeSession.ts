import { useState, useEffect, useRef } from 'react';
import { App } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUserWords, useWordsStore } from '@/store/useWords';
import { useSettings } from '@/store/useSettings';
import {
  generatePracticeBatch,
  judgeTranslation,
  judgeCloze,
  getClozeExpectedForm,
  generateMnemonicTip,
  analyzeSentenceStructure,
  isLazyMetaSentence,
  type SentenceStructureAnalysis,
} from '@/api/llm';
import { applyReview, isNew } from '@/utils/scheduler';
import { setLS, getLS, todayKey } from '@/utils/date';
import type { Word } from '@/types/word';
import {
  clearPracticeSession,
  hydratePracticeSession,
  readSavedPracticeSession,
  savePracticeSession,
  parsePracticeMode,
  parseStudyScope,
  type StudyScope,
} from '@/utils/practiceSession';
import {
  exampleFromCache,
  llmGenMode,
  pickSessionWords,
  selectDailyWords,
  selectNewWords,
  selectReviewWords,
  SESSION_SIZE,
  type Mode,
  type Question,
} from '@/utils/practiceSelect';
import { recordLearningEvent } from '@/utils/learningLog';

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

/** Start after 1 ready; small background batches keep the queue warm without long waits */
const PREFETCH_INITIAL = 1;
const PREFETCH_BATCH = 3;
const PREFETCH_AHEAD = 5;

export function usePracticeSession() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const settings = useSettings();
  const words = useUserWords();
  const updateWord = useWordsStore((s) => s.updateWord);

  const initialMode: Mode = parsePracticeMode(searchParams.get('mode'));
  const initialScope: StudyScope = parseStudyScope(searchParams.get('scope'));
  const hasModeParam = searchParams.has('mode');
  const wantResume = searchParams.get('resume') === '1';

  const [phase, setPhase] = useState<Phase>(
    hasModeParam || wantResume ? 'loading' : 'selecting'
  );
  const [mode, setMode] = useState<Mode>(initialMode);
  const [scope, setScope] = useState<StudyScope>(initialScope);
  const [sessionWords, setSessionWords] = useState<Word[]>([]);
  const [queue, setQueue] = useState<(Question | null)[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [hintShown, setHintShown] = useState(false);
  const [mnemonicTip, setMnemonicTip] = useState('');
  const [mnemonicLoading, setMnemonicLoading] = useState(false);
  const [structureTip, setStructureTip] = useState<SentenceStructureAnalysis | null>(null);
  const [structureLoading, setStructureLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const [userText, setUserText] = useState('');
  const [judgeResult, setJudgeResult] = useState<JudgeResult>(null);
  const [stats, setStats] = useState({ correct: 0, total: 0 });

  const sessionIdRef = useRef(0);
  const inflightRef = useRef<Set<string>>(new Set());
  const prefetchRunningRef = useRef(false);
  const prefetchFromRef = useRef(0);
  const queueRef = useRef<(Question | null)[]>([]);
  const startedRef = useRef(false);
  /** Snapshot: word was new when this session started */
  const wasNewRef = useRef<Map<string, boolean>>(new Map());

  const current = queue[idx] || null;
  const total = sessionWords.length;
  const progressPct = Math.min(100, Math.round((idx / Math.max(total, 1)) * 100));
  const canGoNext = mode === 'choice' ? showAnswer : !!judgeResult;
  const remainingCount =
    scope === 'new'
      ? selectNewWords(words).length
      : scope === 'review'
        ? selectReviewWords(words).length
        : selectDailyWords(words).length;

  function setQueueBoth(updater: (prev: (Question | null)[]) => (Question | null)[]) {
    setQueue((prev) => {
      const next = updater(prev);
      queueRef.current = next;
      return next;
    });
  }

  function persist(overrides: Partial<{
    phase: Phase;
    idx: number;
    queue: (Question | null)[];
    sessionWords: Word[];
    mode: Mode;
    scope: StudyScope;
    stats: { correct: number; total: number };
    showAnswer: boolean;
    hintShown: boolean;
    picked: string | null;
    userText: string;
    judgeResult: JudgeResult;
  }> = {}) {
    savePracticeSession({
      mode: overrides.mode ?? mode,
      scope: overrides.scope ?? scope,
      sessionWords: overrides.sessionWords ?? sessionWords,
      idx: overrides.idx ?? idx,
      queue: overrides.queue ?? queueRef.current,
      stats: overrides.stats ?? stats,
      showAnswer: overrides.showAnswer ?? showAnswer,
      hintShown: overrides.hintShown ?? hintShown,
      picked: overrides.picked !== undefined ? overrides.picked : picked,
      userText: overrides.userText ?? userText,
      judgeResult: overrides.judgeResult !== undefined ? overrides.judgeResult : judgeResult,
      phase: overrides.phase ?? phase,
    });
  }

  useEffect(() => {
    if (startedRef.current) return;
    if (words.length === 0) return;
    if (wantResume) {
      startedRef.current = true;
      resumePractice();
      return;
    }
    if (hasModeParam) {
      startedRef.current = true;
      startPractice(initialMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasModeParam, wantResume, words.length > 0]);

  // Auto-save progress while practicing
  useEffect(() => {
    if (phase === 'asking' || phase === 'waiting' || phase === 'judging') {
      persist();
    } else if (phase === 'done') {
      clearPracticeSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx, queue, showAnswer, hintShown, picked, userText, judgeResult, stats]);

  // 输入填空：提交后加载 / 生成助记提示（同 example.html）
  useEffect(() => {
    if (mode !== 'cloze' || !showAnswer || !current) return;
    const word = current.word;
    const existing = String(word.mnemonic || '').trim();
    if (existing) {
      setMnemonicTip(existing);
      setMnemonicLoading(false);
      return;
    }
    if (!settings.apiKey) {
      setMnemonicTip('');
      setMnemonicLoading(false);
      return;
    }

    let cancelled = false;
    setMnemonicLoading(true);
    (async () => {
      try {
        const tip = await generateMnemonicTip(word.word, settings);
        if (cancelled) return;
        if (tip) {
          setMnemonicTip(tip);
          await updateWord({ ...word, mnemonic: tip });
        }
      } catch {
        /* ignore generate failures */
      } finally {
        if (!cancelled) setMnemonicLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showAnswer, current?.word.id, idx]);

  // 输入填空 / 选词填空：揭晓后 AI 句型分析
  useEffect(() => {
    if ((mode !== 'cloze' && mode !== 'choice') || !showAnswer || !current) {
      return;
    }
    if (!settings.apiKey) {
      setStructureTip(null);
      setStructureLoading(false);
      return;
    }

    let cancelled = false;
    setStructureTip(null);
    setStructureLoading(true);
    (async () => {
      try {
        const tip = await analyzeSentenceStructure(
          current.example.en,
          current.example.zh || '',
          current.word.word,
          settings
        );
        if (!cancelled) setStructureTip(tip);
      } catch {
        if (!cancelled) setStructureTip(null);
      } finally {
        if (!cancelled) setStructureLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showAnswer, current?.word.id, current?.example.en, idx]);

  // Save when leaving the page
  useEffect(() => {
    const onHide = () => {
      if (phase === 'asking' || phase === 'waiting' || phase === 'judging') persist();
    };
    window.addEventListener('beforeunload', onHide);
    return () => {
      window.removeEventListener('beforeunload', onHide);
      onHide();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx, queue, showAnswer, hintShown, picked, userText, judgeResult, stats, mode, sessionWords]);

  function toQuestion(
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
      example: exampleFromCache(word, sentence, m, distractors),
      source,
      wasNew: wasNewRef.current.get(word.id) ?? isNew(word),
    };
  }

  async function fillBatch(sid: number, list: Word[], m: Mode, pool: Word[]) {
    const todo = list.filter((w) => !inflightRef.current.has(w.id) && !queueRef.current[pool.findIndex((x) => x.id === w.id)]);
    if (!todo.length) return;
    todo.forEach((w) => inflightRef.current.add(w.id));

    try {
      const map = await generatePracticeBatch(todo, llmGenMode(m), settings);
      if (sessionIdRef.current !== sid) return;

      setQueueBoth((prev) => {
        const next = [...prev];
        for (const w of todo) {
          const i = pool.findIndex((x) => x.id === w.id);
          if (i < 0 || next[i] || !map[w.id]) continue;
          next[i] = toQuestion(w, map[w.id], m, pool);
        }
        return next;
      });

      const failed = todo.filter((w) => !map[w.id]);
      if (failed.length) {
        console.warn('[practice] fillBatch missing', failed.map((w) => w.word).join(', '));
      }
    } catch (e) {
      console.warn('[practice] fillBatch error', e);
    } finally {
      todo.forEach((w) => inflightRef.current.delete(w.id));
    }
  }

  async function resumePractice() {
    const saved = readSavedPracticeSession();
    if (!saved) {
      message.info('没有可继续的进度');
      navigate('/today');
      return;
    }
    const hydrated = hydratePracticeSession(saved, words);
    if (!hydrated) {
      clearPracticeSession();
      message.info('进度已失效，请重新开始');
      navigate('/today');
      return;
    }

    const sid = ++sessionIdRef.current;
    inflightRef.current = new Set();
    prefetchRunningRef.current = false;

    setMode(hydrated.mode);
    setScope(hydrated.scope);
    wasNewRef.current = new Map(
      hydrated.sessionWords.map((w) => [w.id, isNew(w)])
    );
    setSessionWords(hydrated.sessionWords);
    queueRef.current = hydrated.queue;
    setQueue(hydrated.queue);
    setIdx(hydrated.idx);
    setStats(hydrated.stats);
    setShowAnswer(hydrated.showAnswer);
    setHintShown(hydrated.hintShown);
    setMnemonicTip(hydrated.showAnswer ? (hydrated.queue[hydrated.idx]?.word.mnemonic || '') : '');
    setMnemonicLoading(false);
    setStructureTip(null);
    setStructureLoading(false);
    setPicked(hydrated.picked);
    setUserText(hydrated.userText);
    setJudgeResult(hydrated.judgeResult);

    if (!hydrated.queue[hydrated.idx]) {
      setPhase('loading');
      await fillBatch(sid, [hydrated.sessionWords[hydrated.idx]], hydrated.mode, hydrated.sessionWords);
      if (sessionIdRef.current !== sid) return;
    }
    setPhase('asking');
    kickPrefetch(sid, hydrated.sessionWords, hydrated.mode, hydrated.idx);
    message.success('已恢复练习进度');
  }

  function kickPrefetch(sid: number, pool: Word[], m: Mode, fromIdx: number) {
    prefetchFromRef.current = fromIdx;
    if (prefetchRunningRef.current) return;
    prefetchRunningRef.current = true;
    (async () => {
      try {
        while (sessionIdRef.current === sid) {
          const start = prefetchFromRef.current;
          const missing: Word[] = [];
          const end = Math.min(pool.length, start + PREFETCH_AHEAD);
          for (let i = start; i < end && missing.length < PREFETCH_BATCH; i++) {
            const w = pool[i];
            if (!queueRef.current[i] && !inflightRef.current.has(w.id)) {
              missing.push(w);
            }
          }
          if (!missing.length) break;
          await fillBatch(sid, missing, m, pool);
        }
      } finally {
        prefetchRunningRef.current = false;
        // If idx advanced while we were running, kick again
        if (sessionIdRef.current === sid) {
          const start = prefetchFromRef.current;
          const end = Math.min(pool.length, start + PREFETCH_AHEAD);
          const stillNeed = pool.slice(start, end).some(
            (_w, j) => !queueRef.current[start + j] && !inflightRef.current.has(pool[start + j].id)
          );
          if (stillNeed) kickPrefetch(sid, pool, m, start);
        }
      }
    })();
  }

  async function startPractice(m: Mode, nextScope?: StudyScope) {
    clearPracticeSession();
    const s = nextScope ?? scope ?? initialScope;
    setScope(s);
    const pool = pickSessionWords(words, s);
    if (pool.length === 0) {
      message.info(
        s === 'new'
          ? '没有新词可学'
          : s === 'review'
            ? '暂无待复习的词'
            : '没有可练习的单词'
      );
      navigate('/today');
      return;
    }

    wasNewRef.current = new Map(pool.map((w) => [w.id, isNew(w)]));

    const sid = ++sessionIdRef.current;
    inflightRef.current = new Set();
    prefetchRunningRef.current = false;

    setMode(m);
    setSessionWords(pool);
    const empty = pool.map(() => null);
    queueRef.current = empty;
    setQueue(empty);
    setIdx(0);
    setPicked(null);
    setShowAnswer(false);
    setHintShown(false);
    setMnemonicTip('');
    setMnemonicLoading(false);
    setStructureTip(null);
    setStructureLoading(false);
    setGenError('');
    setUserText('');
    setJudgeResult(null);
    setStats({ correct: 0, total: 0 });
    setPhase('loading');

    const initial = pool.slice(0, Math.min(PREFETCH_INITIAL, pool.length));
    const needLlm: Word[] = [];
    const prefilled = pool.map(() => null as Question | null);

    for (const w of initial) {
      const i = pool.findIndex((x) => x.id === w.id);
      const cached = w.examples?.find((ex) => {
        if (!ex?.en || !ex?.zh) return false;
        if (isLazyMetaSentence(ex.en, w.word)) return false;
        if (m === 'choice') return !!(ex.choiceA && ex.answer);
        return true;
      });
      if (cached && m === 'choice' && cached.choiceA) {
        prefilled[i] = {
          word: w,
          example: cached,
          source: 'cache',
          wasNew: wasNewRef.current.get(w.id),
        };
        console.info(`[practice] ${w.word} ← cache`);
      } else if (cached && m !== 'choice' && cached.en && cached.zh) {
        // For type-in cloze, drop stale MCQ fields if present
        prefilled[i] = {
          word: w,
          example:
            m === 'cloze'
              ? {
                  en: cached.en,
                  zh: cached.zh,
                  blank: getClozeExpectedForm(w.word, cached.en) || w.word,
                }
              : cached,
          source: 'cache',
          wasNew: wasNewRef.current.get(w.id),
        };
        console.info(`[practice] ${w.word} ← cache`);
      } else {
        needLlm.push(w);
      }
    }

    queueRef.current = prefilled;
    setQueue(prefilled);

    if (needLlm.length) {
      await fillBatch(sid, needLlm, m, pool);
    }
    if (sessionIdRef.current !== sid) return;

    if (!queueRef.current[0]) {
      setGenError('出题失败，请检查 API Key / 网络后重试');
      message.error('出题失败，请检查 API Key / 网络后重试');
      setPhase('loading');
      return;
    }

    setGenError('');
    setPhase('asking');
    // Let the first question paint, then warm a small ahead window
    setTimeout(() => {
      if (sessionIdRef.current === sid) kickPrefetch(sid, pool, m, 0);
    }, 300);
  }

  function exitPractice() {
    if (phase === 'asking' || phase === 'waiting' || phase === 'judging') {
      persist();
      message.info('进度已保存，可随时继续');
    }
    navigate('/today');
  }

  // When advancing, wait if next question not ready yet
  useEffect(() => {
    if (phase !== 'asking' && phase !== 'waiting') return;
    if (!sessionWords.length) return;
    if (queue[idx]) {
      if (phase === 'waiting') {
        setGenError('');
        setPhase('asking');
      }
      return;
    }
    setPhase('waiting');
    setGenError('');
    const sid = sessionIdRef.current;
    const w = sessionWords[idx];
    if (!w) return;
    fillBatch(sid, [w], mode, sessionWords).then(() => {
      if (sessionIdRef.current !== sid) return;
      if (queueRef.current[idx]) {
        setGenError('');
        setPhase('asking');
      } else {
        setGenError('本题出题失败，请点下方「重试出题」');
        message.error('本题出题失败，可重试');
      }
    });
    kickPrefetch(sid, sessionWords, mode, idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, queue, phase, sessionWords, mode]);

  function pickAnswer(letter: string) {
    if (showAnswer || !current || mode !== 'choice') return;
    setPicked(letter);
    setShowAnswer(true);
    const correct = letter === current.example.answer;
    setStats((s) => ({
      correct: s.correct + (correct ? 1 : 0),
      total: s.total + 1,
    }));
  }

  async function submitClozeInput() {
    if (!current || mode !== 'cloze' || showAnswer) return;

    const expected =
      current.example.blank ||
      getClozeExpectedForm(current.word.word, current.example.en) ||
      current.word.word;

    // 没填答案 → 直接揭晓 + 助记（不再拦截）
    if (!userText.trim()) {
      setUserText(expected);
      setJudgeResult({
        correct: false,
        expected,
        feedback: '已显示答案',
        revealed: true,
      });
      setShowAnswer(true);
      setHintShown(true);
      setStats((s) => ({ correct: s.correct, total: s.total + 1 }));
      return;
    }

    setPhase('judging');
    try {
      const result = await judgeCloze(
        current.word.word,
        userText,
        current.example.en,
        settings
      );
      setJudgeResult(result);
      setShowAnswer(true);
      setStats((s) => ({
        correct: s.correct + (result.correct ? 1 : 0),
        total: s.total + 1,
      }));
    } catch (e) {
      message.error('评判失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setPhase('asking');
    }
  }

  async function submitTranslate() {
    if (!current) return;
    if (!userText.trim()) {
      message.warning('请输入翻译');
      return;
    }
    setPhase('judging');
    try {
      const result = await judgeTranslation(
        current.word.word,
        current.example.zh,
        current.example.en,
        userText,
        settings
      );
      setJudgeResult(result);
      setStats((s) => ({
        correct: s.correct + (result.correct ? 1 : 0),
        total: s.total + 1,
      }));
    } catch (e) {
      message.error('评判失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setPhase('asking');
    }
  }

  async function next() {
    if (current) {
      const wasCorrect =
        mode === 'choice'
          ? picked === current.example.answer
          : judgeResult?.correct;
      const quality = wasCorrect ? 5 : 1;
      const updated = applyReview(current.word, quality as 1 | 5);
      const examples =
        current.word.examples?.length > 0
          ? current.word.examples
          : [current.example];
      await updateWord({ ...updated, examples });
      recordLearningEvent({
        wasNew: !!current.wasNew,
        correct: !!wasCorrect,
      });
    }
    if (idx + 1 >= total) {
      setPhase('done');
      clearPracticeSession();
      setLS('done-' + todayKey(), '1');
      const lastDay = getLS('last-day');
      const today = new Date().toDateString();
      if (lastDay !== today) {
        const streak = parseInt(getLS('streak') || '0', 10);
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        setLS('streak', String(lastDay === yesterday ? streak + 1 : 1));
        setLS('last-day', today);
      }
    } else {
      setIdx(idx + 1);
      setPicked(null);
      setShowAnswer(false);
      setHintShown(false);
      setMnemonicTip('');
      setMnemonicLoading(false);
      setStructureTip(null);
      setStructureLoading(false);
      setUserText('');
      setJudgeResult(null);
      kickPrefetch(sessionIdRef.current, sessionWords, mode, idx + 1);
    }
  }

  async function regenerateCurrent() {
    if (!sessionWords.length) return;
    if (phase === 'judging') return;
    if (!settings.apiKey) {
      message.warning('请先在设置里填 API Key');
      return;
    }

    const w = current?.word || sessionWords[idx];
    if (!w) return;
    const m = mode;
    const pool = sessionWords;
    const i = idx;
    const sid = sessionIdRef.current;
    const prevQuestion = current;
    const prevEn = current?.example.en || '';

    // Undo score if this card was already judged
    if (current && (showAnswer || judgeResult)) {
      const wasCorrect =
        m === 'choice' ? picked === current.example.answer : !!judgeResult?.correct;
      setStats((s) => ({
        correct: Math.max(0, s.correct - (wasCorrect ? 1 : 0)),
        total: Math.max(0, s.total - 1),
      }));
    }

    setPicked(null);
    setShowAnswer(false);
    setHintShown(false);
    setMnemonicTip('');
    setMnemonicLoading(false);
    setStructureTip(null);
    setStructureLoading(false);
    setUserText('');
    setJudgeResult(null);
    setGenError('');
    setPhase('loading');

    // Clear slot so generate can overwrite
    setQueueBoth((prev) => {
      const next = [...prev];
      next[i] = null;
      return next;
    });
    inflightRef.current.delete(w.id);

    try {
      const map = await generatePracticeBatch([w], llmGenMode(m), settings, {
        avoidEn: prevEn ? [prevEn] : [],
        diverse: true,
      });
      if (sessionIdRef.current !== sid) return;
      if (!map[w.id]) {
        if (prevQuestion) {
          setQueueBoth((prev) => {
            const next = [...prev];
            next[i] = prevQuestion;
            return next;
          });
          setPhase('asking');
        } else {
          setGenError('出题失败，请重试');
        }
        message.error('出题失败，请重试');
        return;
      }
      setQueueBoth((prev) => {
        const next = [...prev];
        next[i] = toQuestion(w, map[w.id], m, pool);
        return next;
      });
      setGenError('');
      setPhase('asking');
      message.success('已换一句');
    } catch (e) {
      if (sessionIdRef.current !== sid) return;
      if (prevQuestion) {
        setQueueBoth((prev) => {
          const next = [...prev];
          next[i] = prevQuestion;
          return next;
        });
        setPhase('asking');
      } else {
        setGenError('出题失败，请重试');
      }
      message.error('出题失败：' + (e instanceof Error ? e.message : '未知错误'));
    }
  }

  async function retryGenerate() {
    setGenError('');
    if (!sessionWords[idx]) return;
    const sid = sessionIdRef.current;
    setPhase('loading');
    inflightRef.current.delete(sessionWords[idx].id);
    await fillBatch(sid, [sessionWords[idx]], mode, sessionWords);
    if (sessionIdRef.current !== sid) return;
    if (queueRef.current[idx]) {
      setGenError('');
      setPhase('asking');
      kickPrefetch(sid, sessionWords, mode, idx);
    } else {
      setGenError('出题失败，请检查 API Key / 网络后重试');
    }
  }

  return {
    phase,
    mode,
    scope,
    current,
    idx,
    total,
    stats,
    progressPct,
    hasModeParam,
    picked,
    showAnswer,
    hintShown,
    userText,
    judgeResult,
    mnemonicTip,
    mnemonicLoading,
    structureTip,
    structureLoading,
    genError,
    canGoNext,
    remainingCount,
    sessionSize: SESSION_SIZE,
    setUserText,
    setHintShown,
    startPractice,
    pickAnswer,
    submitClozeInput,
    submitTranslate,
    next,
    exitPractice,
    regenerateCurrent,
    retryGenerate,
    navigate,
  };
}
