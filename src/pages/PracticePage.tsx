import { useState, useEffect, useRef } from 'react';
import { Button, App, Space, Spin, Input } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, RightOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUserWords, useWordsStore } from '@/store/useWords';
import { useSettings } from '@/store/useSettings';
import {
  generatePracticeBatch,
  buildClozeChoices,
  fallbackPracticeSentence,
  judgeTranslation,
  judgeCloze,
  getClozeExpectedForm,
  generateMnemonicTip,
  isLazyMetaSentence,
} from '@/api/llm';
import { applyReview, isDue, isNew } from '@/utils/scheduler';
import { setLS, getLS, todayKey } from '@/utils/date';
import type { Word, WordExample } from '@/types/word';
import MarkableSentence from '@/components/MarkableSentence';
import {
  clearPracticeSession,
  hydratePracticeSession,
  readSavedPracticeSession,
  savePracticeSession,
  parsePracticeMode,
  modeLabel,
  type PracticeMode,
} from '@/utils/practiceSession';

type Mode = PracticeMode;
type Phase = 'selecting' | 'loading' | 'asking' | 'judging' | 'waiting' | 'done';

function isClozeFamily(m: Mode): boolean {
  return m === 'cloze' || m === 'choice';
}

function llmGenMode(m: Mode): 'cloze' | 'translate' {
  return m === 'translate' ? 'translate' : 'cloze';
}

/** Start after 1 ready; small background batches keep the queue warm without long waits */
const PREFETCH_INITIAL = 1;
const PREFETCH_BATCH = 3;
const PREFETCH_AHEAD = 5;
/** One session at most 50 words — finish then start another batch for the rest */
const SESSION_SIZE = 50;

interface Question {
  word: Word;
  example: WordExample;
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

function selectDailyWords(all: Word[]): Word[] {
  const active = all.filter((w) => !w.crossedOut);
  const due = active.filter((w) => !isNew(w) && isDue(w));
  const fresh = active.filter((w) => isNew(w));
  const soon = active.filter((w) => {
    if (isNew(w) || isDue(w)) return false;
    return w.nextReview <= Date.now() + 3 * 86400000;
  });
  return [...shuffle(fresh), ...shuffle(due), ...shuffle(soon)];
}

/** Pick up to SESSION_SIZE words for this round */
function pickSessionWords(all: Word[]): Word[] {
  return shuffle(selectDailyWords(all)).slice(0, SESSION_SIZE);
}

function exampleFromCache(
  word: Word,
  sentence: { en: string; zh: string },
  mode: Mode,
  distractors: string[]
): WordExample {
  if (mode === 'translate') {
    return { en: sentence.en, zh: sentence.zh };
  }
  if (mode === 'choice') {
    const choices = buildClozeChoices(word.word, distractors);
    return {
      en: sentence.en,
      zh: sentence.zh,
      blank: word.word,
      ...choices,
    };
  }
  // type-in cloze — no MCQ options needed
  return {
    en: sentence.en,
    zh: sentence.zh,
    blank: getClozeExpectedForm(word.word, sentence.en) || word.word,
  };
}

export default function PracticePage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const settings = useSettings();
  const words = useUserWords();
  const updateWord = useWordsStore((s) => s.updateWord);

  const initialMode: Mode = parsePracticeMode(searchParams.get('mode'));
  const hasModeParam = searchParams.has('mode');
  const wantResume = searchParams.get('resume') === '1';

  const [phase, setPhase] = useState<Phase>(
    hasModeParam || wantResume ? 'loading' : 'selecting'
  );
  const [mode, setMode] = useState<Mode>(initialMode);
  const [sessionWords, setSessionWords] = useState<Word[]>([]);
  const [queue, setQueue] = useState<(Question | null)[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [hintShown, setHintShown] = useState(false);
  const [mnemonicTip, setMnemonicTip] = useState('');
  const [mnemonicLoading, setMnemonicLoading] = useState(false);
  const [userText, setUserText] = useState('');
  const [judgeResult, setJudgeResult] = useState<{
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
  } | null>(null);
  const [stats, setStats] = useState({ correct: 0, total: 0 });

  const sessionIdRef = useRef(0);
  const inflightRef = useRef<Set<string>>(new Set());
  const prefetchRunningRef = useRef(false);
  const prefetchFromRef = useRef(0);
  const queueRef = useRef<(Question | null)[]>([]);
  const startedRef = useRef(false);

  const current = queue[idx] || null;
  const total = sessionWords.length;

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
    stats: { correct: number; total: number };
    showAnswer: boolean;
    hintShown: boolean;
    picked: string | null;
    userText: string;
    judgeResult: typeof judgeResult;
  }> = {}) {
    savePracticeSession({
      mode: overrides.mode ?? mode,
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
    sentence: { en: string; zh: string },
    m: Mode,
    pool: Word[]
  ): Question {
    const distractors = pool.filter((w) => w.id !== word.id).map((w) => w.word);
    return { word, example: exampleFromCache(word, sentence, m, distractors) };
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
    setSessionWords(hydrated.sessionWords);
    queueRef.current = hydrated.queue;
    setQueue(hydrated.queue);
    setIdx(hydrated.idx);
    setStats(hydrated.stats);
    setShowAnswer(hydrated.showAnswer);
    setHintShown(hydrated.hintShown);
    setMnemonicTip(hydrated.showAnswer ? (hydrated.queue[hydrated.idx]?.word.mnemonic || '') : '');
    setMnemonicLoading(false);
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
          if (i < 0 || next[i]) continue;
          const sentence = map[w.id] || fallbackPracticeSentence(w, llmGenMode(m));
          next[i] = toQuestion(w, sentence, m, pool);
        }
        return next;
      });
    } catch {
      if (sessionIdRef.current !== sid) return;
      setQueueBoth((prev) => {
        const next = [...prev];
        for (const w of todo) {
          const i = pool.findIndex((x) => x.id === w.id);
          if (i < 0 || next[i]) continue;
          next[i] = toQuestion(w, fallbackPracticeSentence(w, llmGenMode(m)), m, pool);
        }
        return next;
      });
    } finally {
      todo.forEach((w) => inflightRef.current.delete(w.id));
    }
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
            (w, j) => !queueRef.current[start + j] && !inflightRef.current.has(w.id)
          );
          if (stillNeed) kickPrefetch(sid, pool, m, start);
        }
      }
    })();
  }

  async function startPractice(m: Mode) {
    clearPracticeSession();
    const pool = pickSessionWords(words);
    if (pool.length === 0) {
      message.info('没有可练习的单词');
      navigate('/today');
      return;
    }

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
        prefilled[i] = { word: w, example: cached };
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
        };
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

    setQueueBoth((prev) => {
      if (prev[0]) return prev;
      const next = [...prev];
      const w = pool[0];
      next[0] = toQuestion(w, fallbackPracticeSentence(w, llmGenMode(m)), m, pool);
      return next;
    });

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
      if (phase === 'waiting') setPhase('asking');
      return;
    }
    setPhase('waiting');
    const sid = sessionIdRef.current;
    const w = sessionWords[idx];
    if (!w) return;
    fillBatch(sid, [w], mode, sessionWords).then(() => {
      if (sessionIdRef.current === sid) setPhase('asking');
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
      setUserText('');
      setJudgeResult(null);
      kickPrefetch(sessionIdRef.current, sessionWords, mode, idx + 1);
    }
  }

  if (phase === 'selecting' && !hasModeParam) {
    return (
      <div>
        <div className="app-header">
          <h1>选择练习模式</h1>
          <p>挑一种方式开始今日训练</p>
        </div>
        <div className="app-card">
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Button type="primary" size="large" block onClick={() => startPractice('cloze')}>
              输入填空
            </Button>
            <Button size="large" block onClick={() => startPractice('choice')}>
              选词填空
            </Button>
            <Button size="large" block onClick={() => startPractice('translate')}>
              句子翻译
            </Button>
            <Button type="text" block onClick={() => navigate('/today')}>
              返回
            </Button>
          </Space>
        </div>
      </div>
    );
  }

  if (phase === 'loading' || (phase === 'selecting' && hasModeParam) || phase === 'waiting') {
    return (
      <div>
        <div className="practice-header">
          <button type="button" className="back-btn" onClick={exitPractice}>
            ←
          </button>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${total ? Math.round((idx / total) * 100) : 0}%` }}
            />
          </div>
          <div className="progress-text">{total ? `${idx + 1} / ${total}` : '…'}</div>
        </div>
        <div className="app-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Spin size="large" />
          <p className="mt-3" style={{ color: 'var(--text-light)', fontSize: 14 }}>
            AI 正在出题…
          </p>
          <p className="mt-2" style={{ color: 'var(--text-mute)', fontSize: 12 }}>
            先准备前几题，其余答题时后台生成
          </p>
          <p className="mt-2" style={{ color: 'var(--text-mute)', fontSize: 12 }}>
            {mode === 'translate' ? '句子翻译' : mode === 'choice' ? '选词填空' : '输入填空'}
            {total ? ` · ${idx + 1} / ${total}` : ''}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    const remaining = selectDailyWords(words).length;
    const nextBatch = Math.min(SESSION_SIZE, remaining);
    return (
      <div>
        <div className="app-header">
          <h1>练习完成</h1>
          <p>
            正确率 {accuracy}% · {stats.correct}/{stats.total}
          </p>
        </div>
        <div className="today-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
          <h2 style={{ fontSize: 18, opacity: 1, marginBottom: 8 }}>本轮练习完成</h2>
          {remaining > 0 ? (
            <p style={{ fontSize: 13, opacity: 0.85, marginBottom: 16 }}>
              还剩 {remaining} 个词可练，下一组最多 {nextBatch} 个
            </p>
          ) : (
            <p style={{ fontSize: 13, opacity: 0.85, marginBottom: 16 }}>
              今日任务已清完
            </p>
          )}
          {remaining > 0 ? (
            <Button
              size="large"
              block
              onClick={() => startPractice(mode)}
              style={{
                background: 'white',
                color: 'var(--accent)',
                borderColor: 'white',
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              继续下一组 ({nextBatch})
            </Button>
          ) : (
            <Button
              size="large"
              block
              onClick={() => startPractice(mode)}
              style={{
                background: 'white',
                color: 'var(--accent)',
                borderColor: 'white',
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              再练一组
            </Button>
          )}
          <Button
            size="large"
            block
            onClick={() => navigate('/today')}
            style={{
              background: 'rgba(255,255,255,0.18)',
              color: 'white',
              borderColor: 'rgba(255,255,255,0.4)',
            }}
          >
            返回首页
          </Button>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="app-card empty">
        <h3>没有题目</h3>
        <Button type="primary" className="mt-3" onClick={() => navigate('/today')}>
          返回
        </Button>
      </div>
    );
  }

  const progressPct = Math.min(100, Math.round((idx / Math.max(total, 1)) * 100));
  const canGoNext =
    mode === 'choice' ? showAnswer : !!judgeResult;

  return (
    <div>
      <div className="practice-header">
        <button type="button" className="back-btn" onClick={exitPractice} title="退出">
          ←
        </button>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="progress-text">
          {idx + 1} / {total}
        </div>
      </div>

      <div className="practice-card">
        <div className={`mode-tag ${mode === 'translate' ? 'translate-mode' : ''}`}>
          {modeLabel(mode)}
        </div>

        {mode === 'translate' || showAnswer ? (
          <div style={{ marginBottom: 14 }}>
            <div
              className="word-display"
              style={{ fontSize: showAnswer && isClozeFamily(mode) ? 22 : 28 }}
            >
              {isClozeFamily(mode) && showAnswer ? (
                <>
                  答案是{' '}
                  <b style={{ color: 'var(--accent)' }}>
                    {judgeResult?.expected || current.word.word}
                  </b>
                </>
              ) : (
                current.word.word
              )}
            </div>
            {current.word.phonetic && (
              <div style={{ color: 'var(--text-light)', fontSize: 13, marginBottom: 4 }}>
                {current.word.phonetic}
                {current.word.partOfSpeech ? ` · ${current.word.partOfSpeech}` : ''}
              </div>
            )}
          </div>
        ) : (
          <div className="text-light" style={{ fontSize: 13, marginBottom: 14 }}>
            🔍 词不告诉你，看语境猜
          </div>
        )}

        {mode === 'cloze' ? (
          <>
            <MarkableSentence
              text={current.example.en}
              blankWord={current.example.blank || current.word.word}
              blankMode={showAnswer ? 'revealed' : 'input'}
              blankValue={userText}
              onBlankChange={setUserText}
              blankDisabled={showAnswer || phase === 'judging'}
              onBlankEnter={submitClozeInput}
              className="practice-sentence"
            />
            <div className="mark-tip">点句子里不认识的词 → 加入生词表</div>
            {showAnswer || hintShown ? (
              current.example.zh ? (
                <div className="chinese-sentence" style={{ marginBottom: 12 }}>
                  <div className="text-light" style={{ fontSize: 12, marginBottom: 4 }}>整句意思</div>
                  {current.example.zh}
                </div>
              ) : null
            ) : (
              <div className="text-light" style={{ fontSize: 12, marginBottom: 12, opacity: 0.55 }}>
                需要帮助？点「提示」看整句翻译
              </div>
            )}
            {!showAnswer ? (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {!hintShown && (
                  <Button
                    block
                    size="large"
                    onClick={() => setHintShown(true)}
                    disabled={phase === 'judging'}
                  >
                    提示
                  </Button>
                )}
                <Button
                  type="primary"
                  block
                  size="large"
                  onClick={submitClozeInput}
                  loading={phase === 'judging'}
                >
                  检查答案
                </Button>
              </Space>
            ) : (
              judgeResult && (
                <div
                  className={`feedback-area show ${
                    judgeResult.revealed ? '' : judgeResult.correct ? 'correct' : 'wrong'
                  }`}
                  style={{ display: 'block' }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {judgeResult.revealed
                      ? '已显示答案'
                      : judgeResult.correct
                        ? '✓ 正确'
                        : '✗ 不对'}
                  </div>
                  <div>
                    本题答案是{' '}
                    <b>{judgeResult.expected || current.example.blank || current.word.word}</b>
                  </div>
                  {!judgeResult.revealed && judgeResult.feedback && (
                    <div style={{ marginTop: 6 }}>{judgeResult.feedback}</div>
                  )}
                  {judgeResult.wordCompare && (
                    <div className="suggestion" style={{ marginTop: 8 }}>
                      <div className="text-light" style={{ fontSize: 12 }}>用词对比</div>
                      {judgeResult.wordCompare}
                    </div>
                  )}
                  {judgeResult.usageTip && (
                    <div className="suggestion" style={{ marginTop: 8 }}>
                      <div className="text-light" style={{ fontSize: 12 }}>使用习惯</div>
                      {judgeResult.usageTip}
                    </div>
                  )}
                  {judgeResult.grammarTip && (
                    <div className="suggestion" style={{ marginTop: 8 }}>
                      <div className="text-light" style={{ fontSize: 12 }}>语法纠正</div>
                      {judgeResult.grammarTip}
                    </div>
                  )}
                  {current.word.translation && (
                    <div className="suggestion" style={{ marginTop: 8 }}>
                      <div className="text-light" style={{ fontSize: 12, marginBottom: 2 }}>
                        「{current.word.word}」词义复习
                      </div>
                      <div style={{ lineHeight: 1.6 }}>{current.word.translation}</div>
                    </div>
                  )}
                  {(mnemonicLoading || mnemonicTip) && (
                    <div className="suggestion cloze-mnemonic" style={{ marginTop: 8 }}>
                      {mnemonicLoading && !mnemonicTip ? (
                        <span className="text-light" style={{ fontSize: 12 }}>
                          助记加载中…
                        </span>
                      ) : (
                        <>
                          <div className="text-light" style={{ fontSize: 12, marginBottom: 2 }}>
                            💡 助记 · 词根词缀
                          </div>
                          <div style={{ lineHeight: 1.65 }}>{mnemonicTip}</div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            )}
          </>
        ) : mode === 'choice' ? (
          <>
            <MarkableSentence
              text={current.example.en}
              blankWord={current.example.blank || current.word.word}
              blankMode={showAnswer ? 'revealed' : 'hidden'}
            />
            <div className="mark-tip">点句子里不认识的词 → 加入生词表</div>
            {showAnswer && current.example.zh && (
              <div className="chinese-sentence" style={{ marginBottom: 12 }}>
                <div className="text-light" style={{ fontSize: 12, marginBottom: 4 }}>整句意思</div>
                {current.example.zh}
              </div>
            )}
            {!showAnswer && (
              <div className="text-light" style={{ fontSize: 12, marginBottom: 12, opacity: 0.55 }}>
                需要帮助？选完答案后会显示整句翻译
              </div>
            )}
            <div className="cloze-options">
              {(['A', 'B', 'C', 'D'] as const).map((letter) => {
                const opt = current.example[`choice${letter}` as 'choiceA'];
                if (!opt) return null;
                const isPicked = picked === letter;
                const isCorrect = current.example.answer === letter;
                let style: React.CSSProperties = {};
                if (showAnswer && isCorrect)
                  style = { background: 'var(--accent-light)', borderColor: 'var(--accent)' };
                else if (showAnswer && isPicked && !isCorrect)
                  style = { background: 'var(--error-light)', borderColor: 'var(--error)' };
                return (
                  <Button key={letter} block onClick={() => pickAnswer(letter)} style={style}>
                    {letter}. {opt}
                  </Button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="chinese-sentence">{current.example.zh}</div>
            <Input.TextArea
              value={userText}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setUserText(e.target.value)}
              placeholder="把上面的中文翻译成英文..."
              autoSize={{ minRows: 4, maxRows: 8 }}
              disabled={!!judgeResult}
              style={{ marginTop: 12, fontSize: 16 }}
            />
            <div className="text-light" style={{ fontSize: 12, marginTop: 6 }}>
              提示：用上「{current.word.word}」这个词
              {!judgeResult ? ' · 写完点检查，会显示参考译文' : ''}
            </div>
            {!judgeResult ? (
              <Button
                type="primary"
                block
                onClick={submitTranslate}
                style={{ marginTop: 12 }}
                loading={phase === 'judging'}
              >
                检查答案
              </Button>
            ) : (
              <div
                className={`feedback-area show ${judgeResult.correct ? 'correct' : 'wrong'}`}
                style={{ display: 'block' }}
              >
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {judgeResult.correct ? <CheckCircleOutlined /> : <CloseCircleOutlined />}{' '}
                  {judgeResult.score ?? 0}/100
                </div>
                <div style={{ marginTop: 8 }}>{judgeResult.feedback}</div>
                {judgeResult.improved && (
                  <div style={{ marginTop: 8 }}>
                    <b>改进：</b>
                    {judgeResult.improved}
                  </div>
                )}
                <div style={{ marginTop: 10, padding: 12, background: 'var(--bg)', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 4 }}>参考译文</div>
                  <MarkableSentence text={current.example.en} className="practice-ref-sentence" />
                  <div className="mark-tip" style={{ marginBottom: 0 }}>点句子里不认识的词 → 加入生词表</div>
                </div>
              </div>
            )}
          </>
        )}

        {canGoNext && (
          <Button
            type="primary"
            block
            size="large"
            onClick={next}
            style={{ marginTop: 16 }}
            icon={<RightOutlined />}
          >
            {idx + 1 >= total ? '完成' : '下一题 →'}
          </Button>
        )}
      </div>

      <div
        className="app-card text-light"
        style={{ fontSize: 12, textAlign: 'center', padding: 12, marginTop: 14 }}
      >
        本轮已答对 <b style={{ color: 'var(--accent)' }}>{stats.correct}</b> · 共 {stats.total} 题
      </div>
    </div>
  );
}
