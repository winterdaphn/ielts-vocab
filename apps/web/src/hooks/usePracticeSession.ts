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
  generateRelatedWords,
  analyzeSentenceStructure,
  generateTranslateHints,
  type SentenceStructureAnalysis,
  type TranslateHints,
} from '@/api/llm';
import { applyReview, isNew, formatNextReview } from '@/utils/scheduler';
import {
  clearPracticeProgress,
  ensureSyncBootstrap,
} from '@/api/realtimeSync';
import {
  cloudSessionFromSaved,
  loadActiveCloudPractice,
  flushCloudSessionPatch,
  flushCloudItemPatches,
  scheduleCloudSessionPatch,
  startCloudPracticeSession,
  syncCloudItemAttempt,
  syncCloudItemExample,
  readCloudMeta,
} from '@/api/practiceCloudSync';
import { getRelatedFromBank, mergeSynonymSources, getBankLexisExtras, ensureVocabBankRelated } from '@/utils/vocabBankRelated';
import { setLS, getLS, todayKey } from '@/utils/date';
import type { RelatedWord, Word, Derivative } from '@/types/word';
import {
  hydratePracticeSession,
  readSavedPracticeSession,
  savePracticeSession,
  choosePracticeSession,
  reconcilePracticeSession,
  isPracticeSessionFinished,
  parsePracticeMode,
  parseStudyScope,
  parseSentenceDifficulty,
  readPracticeDone,
  savePracticeDone,
  clearPracticeDone,
  practiceDoneMatchesRoute,
  type StudyScope,
  type SentenceDifficulty,
  type SavedPracticeDone,
} from '@/utils/practiceSession';
import {
  notifyPracticeSyncFailure,
  setPracticeSyncBoundSession,
} from '@/utils/practiceSyncDebug';
import {
  exampleFromCache,
  llmGenMode,
  pickSessionWords,
  selectDailyWords,
  selectNewWords,
  selectReviewWords,
  selectStarredWords,
  shuffle,
  SESSION_SIZE,
  type Mode,
  type Question,
} from '@/utils/practiceSelect';
import { recordLearningEvent } from '@/utils/learningLog';
import { lookupYoudaoWord, canUseYoudao } from '@/api/youdao';

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
  const initialDifficulty: SentenceDifficulty = parseSentenceDifficulty(
    searchParams.get('difficulty')
  );
  const hasModeParam = searchParams.has('mode');
  const wantResume = searchParams.get('resume') === '1';

  const [phase, setPhase] = useState<Phase>(
    hasModeParam || wantResume ? 'loading' : 'selecting'
  );
  const [mode, setMode] = useState<Mode>(initialMode);
  const [scope, setScope] = useState<StudyScope>(initialScope);
  const [difficulty, setDifficulty] = useState<SentenceDifficulty>(initialDifficulty);
  const [sessionWords, setSessionWords] = useState<Word[]>([]);
  const [queue, setQueue] = useState<(Question | null)[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [hintShown, setHintShown] = useState(false);
  const [translateHintLevel, setTranslateHintLevel] = useState(0);
  const [translateHints, setTranslateHints] = useState<TranslateHints | null>(null);
  const [translateHintLoading, setTranslateHintLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [mnemonicTip, setMnemonicTip] = useState('');
  const [mnemonicLoading, setMnemonicLoading] = useState(false);
  const [synonymsTip, setSynonymsTip] = useState<RelatedWord[]>([]);
  const [similarsTip, setSimilarsTip] = useState<RelatedWord[]>([]);
  const [derivativesTip, setDerivativesTip] = useState<Derivative[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [structureTip, setStructureTip] = useState<SentenceStructureAnalysis | null>(null);
  const [structureLoading, setStructureLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const [userText, setUserText] = useState('');
  const [judgeResult, setJudgeResult] = useState<JudgeResult>(null);
  const [stats, setStats] = useState({ correct: 0, total: 0 });

  const sessionIdRef = useRef(0);
  /** 再次测试：同一批词重练，不写入 SRS / 学习统计 */
  const skipReviewRef = useRef(false);
  type CardSnapshot = {
    showAnswer: boolean;
    picked: string | null;
    judgeResult: JudgeResult;
    hintShown: boolean;
    translateHintLevel: number;
    translateHints: TranslateHints | null;
  };
  /** 已作答题目的 UI 快照，支持返回上一题 */
  const cardStatesRef = useRef<Map<number, CardSnapshot>>(new Map());
  /** 已提交作答摘要（无完整快照时的兜底，如续做恢复） */
  const attemptByIdxRef = useRef<
    Map<number, { picked: string | null; judgeResult: JudgeResult; correct: boolean }>
  >(new Map());
  /** 已写入 SRS 的题号，返回后再点下一题不重复计分 */
  const reviewedIndicesRef = useRef<Set<number>>(new Set());
  /** 本轮已到达的最远题号，支持回到前面后再前进到未作答但已浏览的题 */
  const maxVisitedIdxRef = useRef(0);
  const modeSelectBatchRef = useRef<Word[]>([]);
  const cloudPracticeSessionIdRef = useRef<string | null>(readCloudMeta()?.sessionId ?? null);

  function bindPracticeCloudId(sessionId: string | null, source: string) {
    cloudPracticeSessionIdRef.current = sessionId;
    setPracticeSyncBoundSession(sessionId, source);
  }
  if (cloudPracticeSessionIdRef.current) {
    setPracticeSyncBoundSession(cloudPracticeSessionIdRef.current, 'init_meta');
  }
  const inflightRef = useRef<Set<string>>(new Set());
  const prefetchRunningRef = useRef(false);
  const prefetchFromRef = useRef(0);
  /** Words that already failed prefetch this session — do not spin forever */
  const prefetchFailedRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<(Question | null)[]>([]);
  const startedRef = useRef(false);
  /** 主动退出时已 flush，卸载清理不要再打一遍 */
  const exitingRef = useRef(false);
  /** Snapshot: word was new when this session started */
  const wasNewRef = useRef<Map<string, boolean>>(new Map());
  /** Sync copy for fillBatch / prefetch (avoids stale state after setDifficulty) */
  const difficultyRef = useRef<SentenceDifficulty>(initialDifficulty);
  difficultyRef.current = difficulty;
  /** 关页保存用：始终指向最新练习状态，避免 effect 依赖 queue 导致预取时狂刷云端 */
  const leaveSnapshotRef = useRef({
    phase,
    idx,
    mode,
    scope,
    difficulty,
    sessionWords,
    stats,
    showAnswer,
    hintShown,
    translateHintLevel,
    translateHints,
    picked,
    judgeResult,
  });
  leaveSnapshotRef.current = {
    phase,
    idx,
    mode,
    scope,
    difficulty,
    sessionWords,
    stats,
    showAnswer,
    hintShown,
    translateHintLevel,
    translateHints,
    picked,
    judgeResult,
  };

  const current = queue[idx] || null;
  const total = sessionWords.length;
  const progressPct = Math.min(100, Math.round((idx / Math.max(total, 1)) * 100));
  const canGoNext = mode === 'choice' ? showAnswer : !!judgeResult;
  const canNavigateNext = canGoNext || idx < maxVisitedIdxRef.current;
  const nextRef = useRef<() => void>(() => {});
  const prevPhaseRef = useRef<Phase>(phase);
  const remainingCount =
    scope === 'new'
      ? selectNewWords(words).length
      : scope === 'review'
        ? selectReviewWords(words).length
        : scope === 'starred'
          ? selectStarredWords(words).length
          : selectDailyWords(words).length;

  function setQueueBoth(updater: (prev: (Question | null)[]) => (Question | null)[]) {
    setQueue((prev) => {
      const next = updater(prev);
      queueRef.current = next;
      return next;
    });
  }

  function latestWordSnapshot(word: Word): Word {
    const candidates = [
      word,
      words.find((item) => item.id === word.id),
      useWordsStore.getState().words.find((item) => item.id === word.id),
    ].filter((item): item is Word => !!item);
    return candidates.reduce((best, item) =>
      (item.updatedAt || 0) > (best.updatedAt || 0) ? item : best
    );
  }

  function isAbortError(e: unknown): boolean {
    return (
      (e instanceof DOMException && e.name === 'AbortError') ||
      (e instanceof Error && e.name === 'AbortError')
    );
  }

  /** Bump session id + abort in-flight LLM so leave/home stops retries. */
  function cancelSessionWork() {
    sessionIdRef.current += 1;
    prefetchRunningRef.current = false;
    inflightRef.current = new Set();
    prefetchFailedRef.current = new Set();
    try {
      abortRef.current?.abort();
    } catch {
      /* ignore */
    }
    abortRef.current = null;
  }

  function resetNavigationHistory() {
    cardStatesRef.current = new Map();
    attemptByIdxRef.current = new Map();
    reviewedIndicesRef.current = new Set();
    maxVisitedIdxRef.current = 0;
  }

  function rememberCardAt(ordinal: number, snap: CardSnapshot) {
    cardStatesRef.current.set(ordinal, snap);
  }

  function rememberAttemptAt(
    ordinal: number,
    data: { picked: string | null; judgeResult: JudgeResult; correct: boolean }
  ) {
    attemptByIdxRef.current.set(ordinal, data);
  }

  function cardSnapshotFromAttempt(
    attempt: Record<string, unknown>,
    m: Mode
  ): CardSnapshot | null {
    const picked = typeof attempt.picked === 'string' ? attempt.picked : null;
    const judgeResult = (attempt.judgeResult as JudgeResult) ?? null;
    const correct = !!attempt.correct;

    if (m === 'choice') {
      if (!picked) return null;
      return {
        showAnswer: true,
        picked,
        judgeResult: null,
        hintShown: false,
        translateHintLevel: 0,
        translateHints: null,
      };
    }
    if (m === 'translate') {
      return {
        showAnswer: false,
        picked: null,
        judgeResult: judgeResult ?? { correct, feedback: '（已作答）' },
        hintShown: false,
        translateHintLevel: 0,
        translateHints: null,
      };
    }
    return {
      showAnswer: true,
      picked: null,
      judgeResult: judgeResult ?? {
        correct,
        feedback: '（已作答）',
        revealed: !correct,
      },
      hintShown: true,
      translateHintLevel: 0,
      translateHints: null,
    };
  }

  function seedCardStatesFromAttempts(
    items: { ordinal: number; attempt: Record<string, unknown> | null }[],
    m: Mode,
    upToIdx: number
  ) {
    for (const item of items) {
      if (item.ordinal >= upToIdx || !item.attempt) continue;
      const snap = cardSnapshotFromAttempt(item.attempt, m);
      if (!snap) continue;
      rememberCardAt(item.ordinal, snap);
      rememberAttemptAt(item.ordinal, {
        picked: snap.picked,
        judgeResult: snap.judgeResult,
        correct: !!item.attempt.correct,
      });
      reviewedIndicesRef.current.add(item.ordinal);
    }
  }

  function snapshotCurrentCard() {
    return {
      showAnswer,
      picked,
      judgeResult,
      hintShown,
      translateHintLevel,
      translateHints,
    };
  }

  function applyCardSnapshot(s: ReturnType<typeof snapshotCurrentCard>) {
    setShowAnswer(s.showAnswer);
    setPicked(s.picked);
    setJudgeResult(s.judgeResult);
    setHintShown(s.hintShown);
    setTranslateHintLevel(s.translateHintLevel);
    setTranslateHints(s.translateHints);
  }

  function resetFreshCardUi() {
    setPicked(null);
    setShowAnswer(false);
    setHintShown(false);
    setTranslateHintLevel(0);
    setTranslateHints(null);
    setJudgeResult(null);
  }

  function resetTransientUi() {
    setTranslateHintLoading(false);
    setMnemonicTip('');
    setMnemonicLoading(false);
    setSynonymsTip([]);
    setSimilarsTip([]);
    setRelatedLoading(false);
    setStructureTip(null);
    setStructureLoading(false);
    setUserText('');
    setPhase('asking');
  }

  function goToCard(target: number) {
    maxVisitedIdxRef.current = Math.max(maxVisitedIdxRef.current, target);
    const saved = cardStatesRef.current.get(target);
    if (saved) {
      applyCardSnapshot(saved);
    } else {
      const attempt = attemptByIdxRef.current.get(target);
      const fromAttempt = attempt
        ? cardSnapshotFromAttempt(
            {
              picked: attempt.picked,
              judgeResult: attempt.judgeResult,
              correct: attempt.correct,
            },
            mode
          )
        : null;
      if (fromAttempt) {
        applyCardSnapshot(fromAttempt);
      } else if (reviewedIndicesRef.current.has(target) || target < stats.total) {
        applyCardSnapshot({
          showAnswer: mode !== 'translate',
          picked: null,
          judgeResult:
            mode === 'translate'
              ? { correct: true, feedback: '（已作答）' }
              : null,
          hintShown: mode === 'cloze',
          translateHintLevel: 0,
          translateHints: null,
        });
      } else {
        resetFreshCardUi();
      }
    }
    resetTransientUi();
    setIdx(target);
    kickPrefetch(sessionIdRef.current, sessionWords, mode, target);
  }

  function beginSessionWork(): { sid: number; signal: AbortSignal } {
    try {
      abortRef.current?.abort();
    } catch {
      /* ignore */
    }
    const ac = new AbortController();
    abortRef.current = ac;
    const sid = ++sessionIdRef.current;
    inflightRef.current = new Set();
    prefetchRunningRef.current = false;
    prefetchFailedRef.current = new Set();
    resetNavigationHistory();
    return { sid, signal: ac.signal };
  }

  // Leave practice page → stop background prefetch / LLM retries
  useEffect(() => {
    return () => {
      cancelSessionWork();
    };
  }, []);

  function persist(overrides: Partial<{
    phase: Phase;
    idx: number;
    queue: (Question | null)[];
    sessionWords: Word[];
    mode: Mode;
    scope: StudyScope;
    difficulty: SentenceDifficulty;
    stats: { correct: number; total: number };
    showAnswer: boolean;
    hintShown: boolean;
    translateHintLevel: number;
    translateHints: TranslateHints | null;
    picked: string | null;
    judgeResult: JudgeResult;
    /** 默认 true；预取改 queue 时只存本机，别狂打会话头 PATCH */
    syncCloud?: boolean;
  }> = {}) {
    // Draft answers stay in the input only — no local/cloud persistence.
    savePracticeSession({
      mode: overrides.mode ?? mode,
      scope: overrides.scope ?? scope,
      difficulty: overrides.difficulty ?? difficulty,
      sessionWords: overrides.sessionWords ?? sessionWords,
      idx: overrides.idx ?? idx,
      queue: overrides.queue ?? queueRef.current,
      stats: overrides.stats ?? stats,
      showAnswer: overrides.showAnswer ?? showAnswer,
      hintShown: overrides.hintShown ?? hintShown,
      translateHintLevel: overrides.translateHintLevel ?? translateHintLevel,
      translateHints:
        overrides.translateHints !== undefined
          ? overrides.translateHints
          : translateHints,
      picked: overrides.picked !== undefined ? overrides.picked : picked,
      userText: '',
      judgeResult: overrides.judgeResult !== undefined ? overrides.judgeResult : judgeResult,
      phase: overrides.phase ?? phase,
    });
    if (overrides.syncCloud === false) return;
    const cloudId = cloudPracticeSessionIdRef.current;
    if (cloudId) {
      const savedAt = readSavedPracticeSession()?.savedAt ?? Date.now();
      scheduleCloudSessionPatch({
        sessionId: cloudId,
        idx: overrides.idx ?? idx,
        stats: overrides.stats ?? stats,
        // 提示阶梯只存本机；云端续做不依赖 hint 状态
        uiState: {
          showAnswer: overrides.showAnswer ?? showAnswer,
          picked: overrides.picked !== undefined ? overrides.picked : picked,
          judgeResult:
            overrides.judgeResult !== undefined ? overrides.judgeResult : judgeResult,
        },
        clientUpdatedAt: savedAt,
      });
    } else if (settings.syncToken) {
      notifyPracticeSyncFailure(
        'no_session',
        '练习未绑定云端会话，进度无法跨设备同步'
      );
    }
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
      const done = readPracticeDone();
      if (
        done &&
        practiceDoneMatchesRoute(done, initialMode, initialScope, initialDifficulty)
      ) {
        restoreDonePractice(done);
        return;
      }
      if (readSavedPracticeSession()) {
        resumePractice();
      } else {
        startPractice(initialMode);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasModeParam, wantResume, words.length > 0]);

  // 模式选择页：固定本批词，选词/输入填空共用同一 50 词
  useEffect(() => {
    if (phase !== 'selecting' || hasModeParam || words.length === 0) return;
    modeSelectBatchRef.current = pickSessionWords(words, scope ?? initialScope);
  }, [phase, hasModeParam, scope, initialScope, words]);

  // 本机进度：含预取 queue（续做要用句）
  useEffect(() => {
    if (phase === 'asking' || phase === 'waiting' || phase === 'judging') {
      persist({ syncCloud: false });
    } else if (phase === 'done' && prevPhaseRef.current !== 'done') {
      // 仅进入 done 时收尾一次；勿在 next() 里重复 complete
      if (sessionWords.length) {
        savePracticeDone({
          mode,
          scope,
          difficulty,
          wordIds: sessionWords.map((w) => w.id),
          stats,
        });
      }
      void clearPracticeProgress({ completed: true });
    }
    prevPhaseRef.current = phase;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx, queue, showAnswer, hintShown, translateHintLevel, translateHints, picked, judgeResult, stats]);

  // 云端会话头： mainly 换题 idx；提示/判题中间态不 PATCH（提交时在 handler 里 persist 一次）
  useEffect(() => {
    if (phase === 'asking' || phase === 'waiting' || phase === 'judging') {
      persist({ syncCloud: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

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

  // 揭晓后：近义（词库+AI）/ 形近（仅词库）；有缓存用缓存
  useEffect(() => {
    if ((mode !== 'cloze' && mode !== 'choice') || !showAnswer || !current) {
      return;
    }
    const word = current.word;
    const cachedSyn = Array.isArray(word.synonyms) ? word.synonyms : [];
    const cachedSim = Array.isArray(word.similars) ? word.similars : [];

    let cancelled = false;
    setRelatedLoading(true);
    void (async () => {
      await ensureVocabBankRelated();
      if (cancelled) return;
      const bankExtras = getBankLexisExtras(word.word);
      const deriv =
        Array.isArray(word.derivatives) && word.derivatives.length
          ? word.derivatives
          : bankExtras.derivatives;
      setDerivativesTip(deriv);

      if (cachedSyn.length || cachedSim.length) {
        setSynonymsTip(cachedSyn);
        setSimilarsTip(cachedSim);
        setRelatedLoading(false);
        return;
      }

      setSynonymsTip([]);
      setSimilarsTip([]);
      try {
        const fromBank = getRelatedFromBank(word.word, word.translation || '');
        let youdaoSyn = fromBank.synonyms;
        const similars = fromBank.similars;
        if (canUseYoudao(settings)) {
          try {
            const yd = await lookupYoudaoWord(word.word, settings);
            if (yd.synonyms?.length) youdaoSyn = yd.synonyms;
          } catch {
            /* keep bank */
          }
        }
        const baseSynonyms = mergeSynonymSources([youdaoSyn], 10);
        let aiSyn: RelatedWord[] = [];
        // Dictionary results are enough for practice; only ask the LLM to fill gaps.
        if (settings.apiKey && baseSynonyms.length < 3) {
          try {
            const fromAi = await generateRelatedWords(
              word.word,
              word.translation || '',
              settings
            );
            aiSyn = fromAi.synonyms || [];
          } catch {
            /* keep youdao/bank */
          }
        }
        const synonyms = mergeSynonymSources([baseSynonyms, aiSyn], 10);
        if (cancelled) return;
        setSynonymsTip(synonyms);
        setSimilarsTip(similars);
        if (synonyms.length || similars.length) {
          await updateWord({
            ...word,
            synonyms,
            similars,
          });
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setRelatedLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showAnswer, current?.word.id, idx]);

  // 句型分析改为按需加载（见 requestStructureTip）

  // 关页 / 切后台推云端。只挂载一次，避免依赖 queue 导致预取时反复 cleanup
  useEffect(() => {
    const saveOnLeave = (keepalive = false) => {
      const s = leaveSnapshotRef.current;
      if (s.phase !== 'asking' && s.phase !== 'waiting' && s.phase !== 'judging') return;
      savePracticeSession({
        mode: s.mode,
        scope: s.scope,
        difficulty: s.difficulty,
        sessionWords: s.sessionWords,
        idx: s.idx,
        queue: queueRef.current,
        stats: s.stats,
        showAnswer: s.showAnswer,
        hintShown: s.hintShown,
        translateHintLevel: s.translateHintLevel,
        translateHints: s.translateHints,
        picked: s.picked,
        userText: '',
        judgeResult: s.judgeResult,
        phase: s.phase,
      });
      const cloudId = cloudPracticeSessionIdRef.current;
      if (cloudId) {
        scheduleCloudSessionPatch({
          sessionId: cloudId,
          idx: s.idx,
          stats: s.stats,
          uiState: {
            showAnswer: s.showAnswer,
            picked: s.picked,
            judgeResult: s.judgeResult,
          },
          clientUpdatedAt: readSavedPracticeSession()?.savedAt ?? Date.now(),
        });
      }
      void flushCloudSessionPatch(keepalive ? { keepalive: true } : undefined);
      if (cloudId) void flushCloudItemPatches(cloudId);
    };
    const onUnload = () => saveOnLeave(true);
    const onVis = () => {
      if (document.visibilityState === 'hidden') saveOnLeave(true);
    };
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('visibilitychange', onVis);
      if (!exitingRef.current) saveOnLeave(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      example: {
        ...exampleFromCache(word, sentence, m, distractors),
        difficulty: difficultyRef.current,
      },
      source,
      wasNew: wasNewRef.current.get(word.id) ?? isNew(word),
    };
  }

  /** Returns error message if generation failed hard (API / parse). */
  async function fillBatch(sid: number, list: Word[], m: Mode, pool: Word[]): Promise<string> {
    // 词条 examples 只作收藏回忆，做题不复用；每题走 LLM / 本轮会话预取。
    const todo = list.filter(
      (w) =>
        !inflightRef.current.has(w.id) &&
        !prefetchFailedRef.current.has(w.id) &&
        !queueRef.current[pool.findIndex((x) => x.id === w.id)]
    );
    if (!todo.length) return '';
    todo.forEach((w) => inflightRef.current.add(w.id));

    try {
      const signal = abortRef.current?.signal;
      const map = await generatePracticeBatch(todo, llmGenMode(m), settings, {
        difficulty: difficultyRef.current,
        signal,
        // Prefetch already loops; avoid 2× API calls per word on soft failures
        noRetry: todo.length > 1,
      });
      if (sessionIdRef.current !== sid) return '';

      const next = [...queueRef.current];
      for (const w of todo) {
        const i = pool.findIndex((x) => x.id === w.id);
        if (i < 0 || next[i] || !map[w.id]) continue;
        next[i] = toQuestion(w, map[w.id], m, pool);
      }
      queueRef.current = next;
      setQueue(next);

      // LLM 新生成的例句 → 同步到云端会话；已从后台/本机恢复的不在这里
      const cloudId = cloudPracticeSessionIdRef.current;
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
      for (const w of failed) prefetchFailedRef.current.add(w.id);
      if (failed.length) {
        console.warn('[practice] fillBatch missing', failed.map((w) => w.word).join(', '));
      }
      if (failed.length === todo.length) {
        return '模型返回的句子未通过校验（过短/过长或模板句），请重试';
      }
      return '';
    } catch (e) {
      if (isAbortError(e) || sessionIdRef.current !== sid) return '';
      console.warn('[practice] fillBatch error', e);
      for (const w of todo) prefetchFailedRef.current.add(w.id);
      const msg =
        e instanceof Error && e.message
          ? e.message
          : '出题失败，请检查 API Key / 网络后重试';
      if (sessionIdRef.current === sid) setGenError(msg);
      return msg;
    } finally {
      todo.forEach((w) => inflightRef.current.delete(w.id));
    }
  }

  function restoreDonePractice(done: SavedPracticeDone) {
    const idToWord = new Map(words.map((w) => [w.id, w]));
    const sessionWordsRestored = done.wordIds
      .map((id) => idToWord.get(id))
      .filter((w): w is Word => !!w);
    setMode(parsePracticeMode(done.mode));
    setScope(parseStudyScope(done.scope));
    setDifficulty(parseSentenceDifficulty(done.difficulty));
    difficultyRef.current = parseSentenceDifficulty(done.difficulty);
    setSessionWords(sessionWordsRestored);
    setStats(done.stats);
    setPhase('done');
  }

  async function resumePractice() {
    try {
      await ensureSyncBootstrap();
    } catch {
      /* 拉取失败仍尝试用本机恢复 */
    }
    const done = readPracticeDone();
    if (
      done &&
      practiceDoneMatchesRoute(done, initialMode, initialScope, initialDifficulty)
    ) {
      restoreDonePractice(done);
      return;
    }
    const localRaw = readSavedPracticeSession();
    const activeLocal =
      localRaw && !isPracticeSessionFinished(localRaw) ? localRaw : null;
    const remote = await loadActiveCloudPractice();
    const remoteSaved =
      remote && remote.idx < remote.items.length
        ? cloudSessionFromSaved(remote)
        : null;
    const saved = reconcilePracticeSession(activeLocal, remoteSaved, {
      remoteUpdatedAt: remote?.updatedAt,
    });
    if (saved && remoteSaved && saved === remoteSaved && remote) {
      bindPracticeCloudId(remote.sessionId, 'resume_remote_match');
    }
    if (!saved) {
      message.info('没有可继续的进度');
      navigate('/today');
      return;
    }
    const hydrated = hydratePracticeSession(saved, words);
    if (!hydrated) {
      await clearPracticeProgress();
      message.info('进度已失效，请重新开始');
      navigate('/today');
      return;
    }

    const { sid } = beginSessionWork();

    setMode(hydrated.mode);
    setScope(hydrated.scope);
    setDifficulty(hydrated.difficulty);
    difficultyRef.current = hydrated.difficulty;
    wasNewRef.current = new Map(
      hydrated.sessionWords.map((w) => [w.id, isNew(w)])
    );

    const sameRemoteRound =
      !!remoteSaved &&
      saved.mode === remoteSaved.mode &&
      parseStudyScope(saved.scope) === parseStudyScope(remoteSaved.scope) &&
      parseSentenceDifficulty(saved.difficulty) ===
        parseSentenceDifficulty(remoteSaved.difficulty) &&
      saved.wordIds.length === remoteSaved.wordIds.length &&
      saved.wordIds.every((id, i) => id === remoteSaved.wordIds[i]);
    let createdFreshCloud = false;
    const localWon =
      !!activeLocal &&
      !!saved &&
      choosePracticeSession(activeLocal, remoteSaved, {
        remoteUpdatedAt: remote?.updatedAt,
      }) === activeLocal;
    if (localWon && (!remote || !sameRemoteRound)) {
      const wasNewByWordId: Record<string, boolean> = {};
      for (const word of hydrated.sessionWords) {
        wasNewByWordId[word.id] = wasNewRef.current.get(word.id) ?? isNew(word);
      }
      const cloud = await startCloudPracticeSession({
        mode: hydrated.mode,
        scope: hydrated.scope,
        difficulty: hydrated.difficulty,
        wordIds: hydrated.sessionWords.map((word) => word.id),
        wasNewByWordId,
      });
      bindPracticeCloudId(cloud?.sessionId || null, 'resume_create_cloud');
      createdFreshCloud = !!cloud;
    } else if (remote) {
      bindPracticeCloudId(remote.sessionId, 'resume_remote');
    }

    setSessionWords(hydrated.sessionWords);
    queueRef.current = hydrated.queue;
    setQueue(hydrated.queue);
    setIdx(hydrated.idx);
    setStats(hydrated.stats);
    setShowAnswer(hydrated.showAnswer);
    setHintShown(hydrated.hintShown);
    setTranslateHintLevel(hydrated.translateHintLevel);
    setTranslateHints(hydrated.translateHints);
    setTranslateHintLoading(false);
    setMnemonicTip(hydrated.showAnswer ? (hydrated.queue[hydrated.idx]?.word.mnemonic || '') : '');
    setMnemonicLoading(false);
    setStructureTip(null);
    setStructureLoading(false);
    setPicked(hydrated.picked);
    setUserText('');
    setJudgeResult(hydrated.judgeResult);

    maxVisitedIdxRef.current = hydrated.idx;
    if (remote?.items?.length) {
      seedCardStatesFromAttempts(remote.items, hydrated.mode, hydrated.idx);
    }
    for (let i = 0; i < hydrated.idx; i++) {
      reviewedIndicesRef.current.add(i);
    }
    if (hydrated.showAnswer || hydrated.judgeResult) {
      reviewedIndicesRef.current.add(hydrated.idx);
      rememberCardAt(hydrated.idx, {
        showAnswer: hydrated.showAnswer,
        picked: hydrated.picked,
        judgeResult: hydrated.judgeResult,
        hintShown: hydrated.hintShown,
        translateHintLevel: hydrated.translateHintLevel,
        translateHints: hydrated.translateHints,
      });
    }

    // 本机进度挂到「新建」的空云端会话：需要把本轮已有句种子推上去一次。
    // 若续做用的就是云端 active，例句已在库里，不要再 PUT。
    const cloudId = cloudPracticeSessionIdRef.current;
    if (createdFreshCloud && cloudId) {
      hydrated.queue.forEach((question, ordinal) => {
        if (question?.example) {
          syncCloudItemExample(
            cloudId,
            ordinal,
            question.example,
            !!question.wasNew
          );
        }
      });
    }

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
    if (sessionIdRef.current !== sid) return;
    prefetchRunningRef.current = true;
    (async () => {
      try {
        let idleRounds = 0;
        while (sessionIdRef.current === sid) {
          const start = prefetchFromRef.current;
          const missing: Word[] = [];
          const end = Math.min(pool.length, start + PREFETCH_AHEAD);
          for (let i = start; i < end && missing.length < PREFETCH_BATCH; i++) {
            const w = pool[i];
            if (
              !queueRef.current[i] &&
              !inflightRef.current.has(w.id) &&
              !prefetchFailedRef.current.has(w.id)
            ) {
              missing.push(w);
            }
          }
          if (!missing.length) break;

          const filledBefore = missing.filter((w) => {
            const i = pool.findIndex((x) => x.id === w.id);
            return i >= 0 && !!queueRef.current[i];
          }).length;

          await fillBatch(sid, missing, m, pool);
          if (sessionIdRef.current !== sid) break;

          const filledAfter = missing.filter((w) => {
            const i = pool.findIndex((x) => x.id === w.id);
            return i >= 0 && !!queueRef.current[i];
          }).length;

          // No progress → stop spinning on the same failures
          if (filledAfter <= filledBefore) {
            idleRounds += 1;
            if (idleRounds >= 1) break;
          } else {
            idleRounds = 0;
          }
        }
      } finally {
        prefetchRunningRef.current = false;
        // Only re-kick if idx advanced and there are still non-failed gaps
        if (sessionIdRef.current === sid) {
          const start = prefetchFromRef.current;
          const end = Math.min(pool.length, start + PREFETCH_AHEAD);
          const stillNeed = pool.slice(start, end).some((w, j) => {
            const i = start + j;
            return (
              !queueRef.current[i] &&
              !inflightRef.current.has(w.id) &&
              !prefetchFailedRef.current.has(w.id)
            );
          });
          if (stillNeed) kickPrefetch(sid, pool, m, start);
        }
      }
    })();
  }

  async function startPractice(
    m: Mode,
    nextScope?: StudyScope,
    nextDifficulty?: SentenceDifficulty,
    options?: { pool?: Word[]; skipReview?: boolean }
  ) {
    try {
      await ensureSyncBootstrap();
    } catch {
      /* 拉取失败仍允许开练 */
    }
    clearPracticeDone();
    // 只清本机：云端旧 active 由后面 createPracticeSession 一次性删掉，避免 abandon+create 重复
    await clearPracticeProgress({ cloud: false });
    const s = nextScope ?? scope ?? initialScope;
    const d = nextDifficulty ?? difficulty ?? initialDifficulty;
    setScope(s);
    setDifficulty(d);
    difficultyRef.current = d;
    skipReviewRef.current = !!options?.skipReview;
    const pool =
      options?.pool && options.pool.length > 0
        ? options.pool
        : pickSessionWords(words, s);
    if (pool.length === 0) {
      message.info(
        s === 'new'
          ? '没有新词可学'
          : s === 'review'
            ? '暂无待复习的词'
            : s === 'starred'
              ? '还没有星标词，先在词表点 ★'
              : '没有可练习的单词'
      );
      navigate('/today');
      return;
    }

    wasNewRef.current = new Map(pool.map((w) => [w.id, isNew(w)]));

    const wasNewByWordId: Record<string, boolean> = {};
    for (const w of pool) {
      wasNewByWordId[w.id] = wasNewRef.current.get(w.id) ?? isNew(w);
    }
    bindPracticeCloudId(null, 'start_practice');
    const cloud = await startCloudPracticeSession({
      mode: m,
      scope: s,
      difficulty: d,
      wordIds: pool.map((w) => w.id),
      wasNewByWordId,
    });
    if (cloud) bindPracticeCloudId(cloud.sessionId, 'start_practice_created');

    const { sid } = beginSessionWork();

    setMode(m);
    setSessionWords(pool);
    const empty = pool.map(() => null);
    queueRef.current = empty;
    setQueue(empty);
    setIdx(0);
    setPicked(null);
    setShowAnswer(false);
    setHintShown(false);
    setTranslateHintLevel(0);
    setTranslateHints(null);
    setTranslateHintLoading(false);
    setMnemonicTip('');
    setMnemonicLoading(false);
    setSynonymsTip([]);
    setSimilarsTip([]);
    setRelatedLoading(false);
    setStructureTip(null);
    setStructureLoading(false);
    setGenError('');
    setUserText('');
    setJudgeResult(null);
    setStats({ correct: 0, total: 0 });
    setPhase('loading');

    const initial = pool.slice(0, Math.min(PREFETCH_INITIAL, pool.length));
    const needLlm = [...initial];
    const prefilled = pool.map(() => null as Question | null);

    queueRef.current = prefilled;
    setQueue(prefilled);

    let batchErr = '';
    if (needLlm.length) {
      batchErr = await fillBatch(sid, needLlm, m, pool);
    }
    if (sessionIdRef.current !== sid) return;

    if (!queueRef.current[0]) {
      const detail =
        batchErr || '出题失败，请检查 API Key / 网络后重试';
      setGenError(detail);
      message.error(detail);
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

  /** 模式选择页开始：与本页「选词填空」共用同一批词 */
  function startPracticeFromModeSelect(m: Mode) {
    const s = scope ?? initialScope;
    const d = difficulty ?? initialDifficulty;
    const pool =
      modeSelectBatchRef.current.length > 0
        ? modeSelectBatchRef.current
        : pickSessionWords(words, s);
    void startPractice(m, s, d, { pool });
  }

  /** 用本轮同一批词再测（打乱顺序；默认不写 SRS） */
  function retestSessionWords(nextMode?: Mode) {
    if (!sessionWords.length) return;
    const m = nextMode ?? mode;
    const pool = shuffle(
      sessionWords.map((w) => latestWordSnapshot(w))
    );
    void startPractice(m, scope, difficulty, { pool, skipReview: true });
  }

  function prepareExitPractice() {
    if (exitingRef.current) return;
    exitingRef.current = true;
    const shouldSave =
      phase === 'asking' || phase === 'waiting' || phase === 'judging';
    if (shouldSave) {
      persist();
      const cloudId = cloudPracticeSessionIdRef.current;
      void flushCloudSessionPatch({ keepalive: true });
      if (cloudId) void flushCloudItemPatches(cloudId);
    }
    cancelSessionWork();
  }

  function exitPractice() {
    const shouldSave =
      phase === 'asking' || phase === 'waiting' || phase === 'judging';
    if (phase === 'done') {
      clearPracticeDone();
    }
    prepareExitPractice();
    navigate('/today', { replace: true });
    if (shouldSave) {
      message.info('进度已保存，可随时继续');
    }
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
    // Manual wait for current card — allow one more attempt even if prefetch failed it
    prefetchFailedRef.current.delete(w.id);
    fillBatch(sid, [w], mode, sessionWords).then((err) => {
      if (sessionIdRef.current !== sid) return;
      if (queueRef.current[idx]) {
        setGenError('');
        setPhase('asking');
      } else {
        setGenError(err || '本题出题失败，请点下方「重试出题」');
        message.error('本题出题失败，可重试');
      }
    });
    kickPrefetch(sid, sessionWords, mode, idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, queue, phase, sessionWords, mode]);

  function pickAnswer(letter: string) {
    if (showAnswer || !current || mode !== 'choice') return;
    const correct = letter === current.example.answer;
    const nextStats = {
      correct: stats.correct + (correct ? 1 : 0),
      total: stats.total + 1,
    };
    const snap: CardSnapshot = {
      showAnswer: true,
      picked: letter,
      judgeResult: null,
      hintShown,
      translateHintLevel,
      translateHints,
    };
    rememberCardAt(idx, snap);
    rememberAttemptAt(idx, { picked: letter, judgeResult: null, correct });
    setPicked(letter);
    setShowAnswer(true);
    setStats(nextStats);
    persist({
      syncCloud: true,
      picked: letter,
      showAnswer: true,
      stats: nextStats,
    });
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
      const emptyJudge = {
        correct: false,
        expected,
        feedback: '已显示答案',
        revealed: true,
      } as const;
      const nextStats = { correct: stats.correct, total: stats.total + 1 };
      const snap: CardSnapshot = {
        showAnswer: true,
        picked: null,
        judgeResult: emptyJudge,
        hintShown: true,
        translateHintLevel,
        translateHints,
      };
      rememberCardAt(idx, snap);
      rememberAttemptAt(idx, {
        picked: null,
        judgeResult: emptyJudge,
        correct: false,
      });
      setJudgeResult(emptyJudge);
      setShowAnswer(true);
      setHintShown(true);
      setStats(nextStats);
      persist({
        syncCloud: true,
        judgeResult: emptyJudge,
        showAnswer: true,
        hintShown: true,
        stats: nextStats,
      });
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
      const nextStats = {
        correct: stats.correct + (result.correct ? 1 : 0),
        total: stats.total + 1,
      };
      const snap: CardSnapshot = {
        showAnswer: true,
        picked: null,
        judgeResult: result,
        hintShown,
        translateHintLevel,
        translateHints,
      };
      rememberCardAt(idx, snap);
      rememberAttemptAt(idx, {
        picked: null,
        judgeResult: result,
        correct: !!result.correct,
      });
      setJudgeResult(result);
      setShowAnswer(true);
      setStats(nextStats);
      persist({
        syncCloud: true,
        judgeResult: result,
        showAnswer: true,
        stats: nextStats,
      });
    } catch (e) {
      message.error('评判失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setPhase('asking');
    }
  }

  async function submitTranslate() {
    if (!current) return;
    if (translateHintLevel >= 3) {
      message.info('已显示答案，请点下一题');
      return;
    }
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
      const nextStats = {
        correct: stats.correct + (result.correct ? 1 : 0),
        total: stats.total + 1,
      };
      const snap: CardSnapshot = {
        showAnswer: false,
        picked: null,
        judgeResult: result,
        hintShown,
        translateHintLevel,
        translateHints,
      };
      rememberCardAt(idx, snap);
      rememberAttemptAt(idx, {
        picked: null,
        judgeResult: result,
        correct: !!result.correct,
      });
      setJudgeResult(result);
      setStats(nextStats);
      persist({
        syncCloud: true,
        judgeResult: result,
        stats: nextStats,
      });
    } catch (e) {
      message.error('评判失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setPhase('asking');
    }
  }

  async function next() {
    const browsingForward = !canGoNext && idx < maxVisitedIdxRef.current;
    if (!canGoNext && !browsingForward) return;

    if (canGoNext) {
      const snap = snapshotCurrentCard();
      rememberCardAt(idx, snap);
    } else {
      goToCard(idx + 1);
      return;
    }

    const alreadyReviewed = reviewedIndicesRef.current.has(idx);
    const wasCorrect =
      mode === 'choice'
        ? picked === current?.example.answer
        : !!judgeResult?.correct;
    rememberAttemptAt(idx, { picked, judgeResult, correct: wasCorrect });

    if (current && !skipReviewRef.current && !alreadyReviewed) {
      const quality = wasCorrect ? 5 : 1;
      const latest = latestWordSnapshot(current.word);
      const updated = applyReview(latest, quality as 1 | 5);
      await updateWord(updated);
      recordLearningEvent({
        wasNew: !!current.wasNew,
        correct: !!wasCorrect,
      });
      const cloudId = cloudPracticeSessionIdRef.current;
      if (cloudId) {
        syncCloudItemAttempt(cloudId, idx, {
          correct: !!wasCorrect,
          picked,
          userText,
          judgeResult,
          answeredAt: Date.now(),
        });
      }
      reviewedIndicesRef.current.add(idx);
      const when = formatNextReview(updated.nextReview);
      message.info(
        wasCorrect ? `答对 · 下次复习：${when}` : `答错 · 已回退，${when}再练`
      );
    } else if (current && skipReviewRef.current && !alreadyReviewed) {
      const wasCorrect =
        mode === 'choice'
          ? picked === current.example.answer
          : judgeResult?.correct;
      const cloudId = cloudPracticeSessionIdRef.current;
      if (cloudId) {
        syncCloudItemAttempt(cloudId, idx, {
          correct: !!wasCorrect,
          picked,
          userText,
          judgeResult,
          answeredAt: Date.now(),
        });
      }
      reviewedIndicesRef.current.add(idx);
    }
    if (idx + 1 >= total) {
      setPhase('done');
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
      goToCard(idx + 1);
    }
  }

  function prev() {
    if (idx <= 0) return;
    cardStatesRef.current.set(idx, snapshotCurrentCard());
    goToCard(idx - 1);
  }

  const canGoPrevious = idx > 0;

  nextRef.current = () => {
    void next();
  };

  // 揭晓/判题结果页：Enter → 下一题（对齐 example.html feedback 阶段）
  useEffect(() => {
    if (phase !== 'asking' || !canNavigateNext || regenerating) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.key !== 'Enter') return;

      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable) return;
      if (el) {
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          if (e.shiftKey) return;
          e.preventDefault();
        }
      }

      nextRef.current();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, canNavigateNext, regenerating, idx]);

  async function requestStructureTip() {
    if (!current) return;
    if (mode !== 'cloze' && mode !== 'choice') return;
    if (!settings.apiKey) {
      message.warning('请先在设置里填 API Key');
      return;
    }
    if (structureLoading) return;
    if (structureTip) return;

    setStructureLoading(true);
    try {
      const tip = await analyzeSentenceStructure(
        current.example.en,
        current.example.zh || '',
        current.word.word,
        settings
      );
      setStructureTip(tip);
    } catch (e) {
      setStructureTip(null);
      message.error('句型分析失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setStructureLoading(false);
    }
  }

  async function requestTranslateHint() {
    if (!current || mode !== 'translate' || judgeResult) return;
    if (translateHintLoading) return;

    // Level 0 → 1: fetch AI hints once, then show structure
    if (translateHintLevel <= 0) {
      setTranslateHintLoading(true);
      try {
        const hints =
          translateHints ||
          (await generateTranslateHints(
            current.word.word,
            current.example.zh,
            current.example.en,
            settings
          ));
        setTranslateHints(hints);
        setTranslateHintLevel(1);
      } catch (e) {
        message.error('提示生成失败：' + (e instanceof Error ? e.message : '未知错误'));
      } finally {
        setTranslateHintLoading(false);
      }
      return;
    }

    // Level 1 → 2: keywords
    if (translateHintLevel === 1) {
      setTranslateHintLevel(2);
      return;
    }

    // Level 2 → 3: reveal answer (counts as revealed / incorrect for scheduling)
    if (translateHintLevel === 2) {
      setTranslateHintLevel(3);
      setJudgeResult({
        correct: false,
        score: 0,
        feedback: '已显示参考译文',
        revealed: true,
      });
      setStats((s) => ({ correct: s.correct, total: s.total + 1 }));
    }
  }

  async function regenerateCurrent() {
    if (!sessionWords.length) return;
    if (phase === 'judging' || regenerating) return;
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
    const prevEn = current?.example.en || '';
    setRegenerating(true);
    inflightRef.current.add(w.id);
    prefetchFailedRef.current.delete(w.id);

    try {
      const map = await generatePracticeBatch([w], llmGenMode(m), settings, {
        avoidEn: prevEn ? [prevEn] : [],
        diverse: true,
        difficulty: difficultyRef.current,
        signal: abortRef.current?.signal,
      });
      if (sessionIdRef.current !== sid) return;
      if (!map[w.id]) {
        message.error('出题失败，请重试');
        return;
      }
      const generated = toQuestion(w, map[w.id], m, pool);

      // Only reset the answered card after the replacement is safely ready.
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
      setTranslateHintLevel(0);
      setTranslateHints(null);
      setTranslateHintLoading(false);
      setMnemonicTip('');
      setMnemonicLoading(false);
      setSynonymsTip([]);
      setSimilarsTip([]);
      setRelatedLoading(false);
      setStructureTip(null);
      setStructureLoading(false);
      setUserText('');
      setJudgeResult(null);
      setGenError('');

      setQueueBoth((prev) => {
        const next = [...prev];
        next[i] = generated;
        return next;
      });
      const cloudId = cloudPracticeSessionIdRef.current;
      if (cloudId) {
        syncCloudItemExample(cloudId, i, generated.example, !!generated.wasNew);
      }
      setGenError('');
      message.success('已换一句');
    } catch (e) {
      if (isAbortError(e) || sessionIdRef.current !== sid) return;
      message.error('出题失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      inflightRef.current.delete(w.id);
      setRegenerating(false);
    }
  }

  async function retryGenerate() {
    setGenError('');
    if (!sessionWords[idx]) return;
    const sid = sessionIdRef.current;
    setPhase('loading');
    inflightRef.current.delete(sessionWords[idx].id);
    prefetchFailedRef.current.delete(sessionWords[idx].id);
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

  async function toggleStarred() {
    if (!current) return;
    const latest = latestWordSnapshot(current.word);
    const nextStarred = !latest.starred;
    const updated = { ...latest, starred: nextStarred };
    await updateWord(updated);
    setSessionWords((prev) =>
      prev.map((w) => (w.id === updated.id ? updated : w))
    );
    setQueueBoth((prev) =>
      prev.map((item) =>
        item && item.word.id === updated.id
          ? { ...item, word: updated }
          : item
      )
    );
    message.success(nextStarred ? '已加星标' : '已取消星标');
  }

  async function toggleExampleFavorite() {
    if (!current) return;
    const latest = latestWordSnapshot(current.word);
    const isSame = (example: Word['examples'][number]) =>
      example.en === current.example.en && example.zh === current.example.zh;
    const alreadySaved = (latest.examples || []).some(isSame);
    const savedExample = {
      en: current.example.en,
      zh: current.example.zh,
      blank: current.example.blank,
      difficulty: current.example.difficulty,
    };
    const examples = alreadySaved
      ? (latest.examples || []).filter((example) => !isSame(example))
      : [savedExample, ...(latest.examples || [])];
    const updated = { ...latest, examples };
    await updateWord(updated);
    setSessionWords((prev) =>
      prev.map((word) => (word.id === updated.id ? updated : word))
    );
    setQueueBoth((prev) =>
      prev.map((question) =>
        question?.word.id === updated.id
          ? { ...question, word: updated }
          : question
      )
    );
    message.success(alreadySaved ? '已取消收藏例句' : '例句已收藏到词库');
  }

  const exampleFavorited =
    !!current &&
    (current.word.examples || []).some(
      (example) =>
        example.en === current.example.en && example.zh === current.example.zh
    );

  return {
    phase,
    mode,
    scope,
    difficulty,
    current,
    idx,
    total,
    stats,
    progressPct,
    hasModeParam,
    picked,
    showAnswer,
    hintShown,
    translateHintLevel,
    translateHints,
    translateHintLoading,
    regenerating,
    exampleFavorited,
    userText,
    judgeResult,
    mnemonicTip,
    mnemonicLoading,
    synonymsTip,
    similarsTip,
    derivativesTip,
    relatedLoading,
    structureTip,
    structureLoading,
    structureAvailable: !!settings.apiKey,
    genError,
    canGoNext,
    canNavigateNext,
    canGoPrevious,
    remainingCount,
    sessionSize: SESSION_SIZE,
    setUserText,
    setHintShown,
    startPractice,
    startPracticeFromModeSelect,
    retestSessionWords,
    pickAnswer,
    submitClozeInput,
    submitTranslate,
    requestTranslateHint,
    requestStructureTip,
    next,
    prev,
    exitPractice,
    prepareExitPractice,
    regenerateCurrent,
    retryGenerate,
    toggleStarred,
    toggleExampleFavorite,
    navigate,
  };
}
