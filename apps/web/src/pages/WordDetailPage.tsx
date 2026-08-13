import { useMemo, useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button, App, Popconfirm, Input, Space } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  MinusOutlined,
  UndoOutlined,
  CloseOutlined,
  ReadOutlined,
  PlusOutlined,
  EditOutlined,
  StarOutlined,
  StarFilled,
} from '@ant-design/icons';
import { useUserWords, useWordsStore } from '@/store/useWords';
import { useSettings } from '@/store/useSettings';
import {
  getWordStage,
  wordStageLabel,
  wordStageClass,
  ladderProgressLabel,
  formatNextReview,
  formatReviewInterval,
  estimateRetention,
} from '@/utils/scheduler';
import {
  generateMnemonicTip,
  generateCollocations,
  generateRelatedWords,
  lookupWordInfo,
  judgeSynonymCandidate,
} from '@/api/llm';
import { lookupYoudaoWord, canUseYoudao } from '@/api/youdao';
import {
  getRelatedFromBank,
  mergeSynonymSources,
  resolveBankGloss,
  getBankLexisExtras,
  ensureVocabBankRelated,
} from '@/utils/vocabBankRelated';
import RelatedWordsList from '@/components/RelatedWordsList';
import { useQuickAddRelatedWord } from '@/hooks/useQuickAddRelatedWord';
import CollocationsList from '@/components/CollocationsList';
import DerivativesList from '@/components/DerivativesList';
import MarkableSentence from '@/components/MarkableSentence';
import PhoneticDisplay from '@/components/PhoneticDisplay';
import CollapsibleTip from '@/components/practice/CollapsibleTip';
import { useSynonymDiffAssist } from '@/components/SynonymDiffAssist';
import type { Collocation, RelatedWord } from '@/types/word';
import WordCategoryEditor from '@/components/WordCategoryEditor';
import { normalizeCategories } from '@/config/categories';
import { findWordIndex, wordDetailPath, decodeWordRouteId } from '@/utils/wordId';
import {
  type WordDetailNavState,
  wordDetailBrowseState,
  wordDetailDrillLinkState,
  resolveWordDetailBack,
} from '@/utils/wordDetailNav';
import { useChunksStore, useUserChunks } from '@/store/useChunks';

type TipTab = 'mnemonic' | 'synonyms' | 'similars' | 'derivatives';
type ColoTab = 'dict' | 'mine';

export default function WordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const detailNav = (location.state ?? null) as WordDetailNavState | null;
  const { message, modal } = App.useApp();
  const words = useUserWords();
  const updateWord = useWordsStore((s) => s.updateWord);
  const removeWord = useWordsStore((s) => s.removeWord);
  const settings = useSettings();
  const userChunks = useUserChunks();
  const addFromCollocation = useChunksStore((s) => s.addFromCollocation);
  const deckPhraseKeys = useMemo(
    () => new Set(userChunks.map((c) => c.phraseKey)),
    [userChunks]
  );
  const chunkIdByKey = useMemo(
    () => new Map(userChunks.map((c) => [c.phraseKey, c.id])),
    [userChunks]
  );

  const routeId = id ?? '';
  const idx = useMemo(
    () => findWordIndex(words, routeId),
    [words, routeId]
  );
  const word = idx >= 0 ? words[idx] : undefined;
  const prevWord = idx > 0 ? words[idx - 1] : null;
  const nextWord = idx >= 0 && idx < words.length - 1 ? words[idx + 1] : null;

  const [tipTab, setTipTab] = useState<TipTab>('mnemonic');
  const [coloTab, setColoTab] = useState<ColoTab>('dict');
  const [bankTick, setBankTick] = useState(0);
  const [busyRelated, setBusyRelated] = useState(false);
  const [busyMnemonic, setBusyMnemonic] = useState(false);
  const [busyCollocations, setBusyCollocations] = useState(false);
  const [similarInput, setSimilarInput] = useState('');
  const [busyAddSimilar, setBusyAddSimilar] = useState(false);
  const [showSimilarAdd, setShowSimilarAdd] = useState(false);
  const [synonymInput, setSynonymInput] = useState('');
  const [busyAddSynonym, setBusyAddSynonym] = useState(false);
  const [showSynonymAdd, setShowSynonymAdd] = useState(false);
  const [coloPhrase, setColoPhrase] = useState('');
  const [coloGloss, setColoGloss] = useState('');
  const [busyAddColo, setBusyAddColo] = useState(false);
  const [showColoAdd, setShowColoAdd] = useState(false);
  const [editingMnemonic, setEditingMnemonic] = useState(false);
  const [mnemonicDraft, setMnemonicDraft] = useState('');
  const [busySaveMnemonic, setBusySaveMnemonic] = useState(false);

  const synonymDiff = useSynonymDiffAssist({
    headword: word?.word || '',
    translation: word?.translation || '',
    synonyms: word?.synonyms || [],
    sentence: (word?.examples || []).find((ex) => ex?.en)?.en || '',
    stored: word?.synonymDiff,
    onSave: async (diff) => {
      const latest = words.find((w) => w.id === word?.id);
      if (!latest) return;
      await updateWord({ ...latest, synonymDiff: diff });
    },
  });
  const { addRelatedToBank, addingKey, justAddedKey } = useQuickAddRelatedWord();

  // 切换词条时退出编辑态
  useEffect(() => {
    setEditingMnemonic(false);
    setMnemonicDraft('');
    setShowSimilarAdd(false);
    setShowSynonymAdd(false);
    setSynonymInput('');
    setShowColoAdd(false);
    setColoTab('dict');
  }, [id]);

  useEffect(() => {
    void ensureVocabBankRelated().then(() => setBankTick((n) => n + 1));
  }, []);

  // 旧导入词：从内置词库补上派生词 / 词典搭配（不覆盖已有）
  useEffect(() => {
    if (!word) return;
    let cancelled = false;
    void (async () => {
      await ensureVocabBankRelated();
      if (cancelled) return;
      const bank = getBankLexisExtras(word.word);
      const needDeriv =
        !(word.derivatives && word.derivatives.length) && bank.derivatives.length > 0;
      const needDict =
        !(word.dictCollocations && word.dictCollocations.length) &&
        bank.dictCollocations.length > 0;
      if (!needDeriv && !needDict) return;
      await updateWord({
        ...word,
        ...(needDeriv ? { derivatives: bank.derivatives } : {}),
        ...(needDict ? { dictCollocations: bank.dictCollocations } : {}),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [word?.id, word?.word]);

  // 旧 UUID 书签 → 规范 /words/lemma
  useEffect(() => {
    if (!word || !routeId) return;
    const decoded = decodeWordRouteId(routeId);
    if (word.id === decoded) return;
    navigate(wordDetailPath(word), {
      replace: true,
      state: wordDetailBrowseState(detailNav),
    });
  }, [word, routeId, navigate, detailNav]);

  const bankExtras = useMemo(
    () => (word ? getBankLexisExtras(word.word) : { derivatives: [], dictCollocations: [] }),
    // bankTick refreshes after lazy vocab load
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [word?.word, bankTick]
  );

  if (!id || !word) {
    return (
      <div className="app-card empty">
        <h3>找不到这个词</h3>
        <p className="text-light">可能已删除，或同步后 id 变化</p>
        <Button type="primary" className="mt-3" onClick={() => navigate('/words')}>
          返回词表
        </Button>
      </div>
    );
  }

  const stage = getWordStage(word);
  const synonyms = word.synonyms || [];
  const similars = word.similars || [];
  const derivatives =
    word.derivatives && word.derivatives.length
      ? word.derivatives
      : bankExtras.derivatives;
  const collocations = word.collocations || [];
  const dictCollocations =
    word.dictCollocations && word.dictCollocations.length
      ? word.dictCollocations
      : bankExtras.dictCollocations;
  const examples = (word.examples || []).filter((ex) => ex?.en).slice(0, 3);
  const accuracy =
    word.totalReviews > 0
      ? Math.round((word.correctReviews / word.totalReviews) * 100)
      : null;
  const retention = estimateRetention(word);

  async function fillRelated() {
    setBusyRelated(true);
    try {
      await ensureVocabBankRelated();
      const fromBank = getRelatedFromBank(word!.word, word!.translation || '');
      // 形近：仅词库；若用户已改过（有列表），补全时不覆盖，避免删掉的又回来
      const existingSim = word!.similars || [];
      const similars = existingSim.length ? existingSim : fromBank.similars;

      let youdaoSyn = fromBank.synonyms;
      if (canUseYoudao(settings)) {
        try {
          const yd = await lookupYoudaoWord(word!.word, settings);
          if (yd.synonyms?.length) youdaoSyn = yd.synonyms;
        } catch {
          /* keep bank */
        }
      }

      let aiSyn: RelatedWord[] = [];
      if (settings.apiKey) {
        try {
          const fromAi = await generateRelatedWords(
            word!.word,
            word!.translation || '',
            settings
          );
          aiSyn = fromAi.synonyms || [];
        } catch {
          /* keep youdao/bank */
        }
      }

      const synonyms = mergeSynonymSources([youdaoSyn, aiSyn], 10);

      await updateWord({
        ...word!,
        synonyms,
        similars,
      });

      if (!synonyms.length && !similars.length) {
        message.warning(
          settings.apiKey || canUseYoudao(settings)
            ? '暂未补全到近义 / 形近'
            : '词库暂无；配置 API Key / Worker 后可再抓近义词'
        );
      } else {
        message.success(
          `已补全 · 近义 ${synonyms.length}（有道+AI）· 形近 ${similars.length}`
        );
      }
    } catch (e) {
      message.error('补全失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setBusyRelated(false);
    }
  }

  async function removeSimilar(target: string) {
    const next: RelatedWord[] = (word!.similars || []).filter(
      (s) => s.word.toLowerCase() !== target.toLowerCase()
    );
    await updateWord({ ...word!, similars: next });
    message.success(`已移除形近「${target}」`);
  }

  async function removeSynonym(target: string) {
    const next: RelatedWord[] = (word!.synonyms || []).filter(
      (s) => s.word.toLowerCase() !== target.toLowerCase()
    );
    await updateWord({ ...word!, synonyms: next });
    message.success(`已移除近义「${target}」`);
  }

  async function addSynonym() {
    const raw = synonymInput.trim().toLowerCase().replace(/[^a-z'-]/g, '');
    if (!raw) {
      message.warning('请输入近义词');
      return;
    }
    if (raw === word!.word.toLowerCase()) {
      message.warning('不能添加自己');
      return;
    }
    const existing = word!.synonyms || [];
    if (existing.some((s) => s.word.toLowerCase() === raw)) {
      message.warning('列表里已有这个词');
      return;
    }
    if (!settings.apiKey) {
      message.warning('添加近义词需要 API Key，以便 AI 判断是否合适');
      return;
    }

    setBusyAddSynonym(true);
    try {
      let judge;
      try {
        judge = await judgeSynonymCandidate(
          word!.word,
          word!.translation || '',
          raw,
          settings
        );
      } catch (e) {
        message.error('AI 判断失败：' + (e instanceof Error ? e.message : '未知错误'));
        return;
      }

      let lemma = judge.lemma || raw;
      let gloss = judge.gloss || '';

      if (!gloss) {
        const fromBank = resolveBankGloss(lemma);
        if (fromBank) {
          lemma = fromBank.word;
          gloss = fromBank.gloss;
        } else {
          const inList = words.find((w) => w.word.toLowerCase() === lemma);
          if (inList?.translation) {
            lemma = inList.word;
            gloss = inList.translation.split(/[；;，,]/)[0].trim().slice(0, 40);
          }
        }
      }

      if (existing.some((s) => s.word.toLowerCase() === lemma.toLowerCase())) {
        message.warning('列表里已有这个词');
        return;
      }

      const verdict = judge.suitable
        ? `合适（评分 ${judge.score}/5）`
        : `不太合适（评分 ${judge.score}/5）`;
      const confirmed = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: `添加近义「${lemma}」？`,
          content: (
            <div style={{ fontSize: 13, lineHeight: 1.65 }}>
              <div style={{ marginBottom: 8 }}>
                <b>AI 判断：</b>
                {verdict}
              </div>
              <div style={{ color: 'var(--text-light)' }}>{judge.reason}</div>
              {gloss ? (
                <div style={{ marginTop: 8 }}>
                  释义：{gloss}
                </div>
              ) : null}
              {!judge.suitable ? (
                <div style={{ marginTop: 8, color: 'var(--text-light)' }}>
                  仍可强制添加；不合适的近义可能干扰记忆。
                </div>
              ) : null}
            </div>
          ),
          okText: judge.suitable ? '添加' : '仍要添加',
          cancelText: '取消',
          okButtonProps: judge.suitable ? undefined : { danger: true },
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;

      if (!gloss) {
        message.warning('缺少释义，无法添加');
        return;
      }

      await updateWord({
        ...word!,
        synonyms: [...existing, { word: lemma, gloss, source: 'manual' }],
      });
      setSynonymInput('');
      setShowSynonymAdd(false);
      message.success(`已添加近义「${lemma}」`);
    } finally {
      setBusyAddSynonym(false);
    }
  }

  function startEditMnemonic() {
    setMnemonicDraft(word!.mnemonic || '');
    setEditingMnemonic(true);
  }

  async function saveMnemonic() {
    setBusySaveMnemonic(true);
    try {
      const text = mnemonicDraft.trim();
      await updateWord({ ...word!, mnemonic: text });
      setEditingMnemonic(false);
      message.success(text ? '已保存笔记' : '已清空助记');
    } finally {
      setBusySaveMnemonic(false);
    }
  }

  async function addSimilar() {
    const raw = similarInput.trim().toLowerCase().replace(/[^a-z'-]/g, '');
    if (!raw) {
      message.warning('请输入形近单词');
      return;
    }
    if (raw === word!.word.toLowerCase()) {
      message.warning('不能添加自己');
      return;
    }
    const existing = word!.similars || [];
    if (existing.some((s) => s.word.toLowerCase() === raw)) {
      message.warning('列表里已有这个词');
      return;
    }

    setBusyAddSimilar(true);
    try {
      let lemma = raw;
      let gloss = '';

      const fromBank = resolveBankGloss(raw);
      if (fromBank) {
        lemma = fromBank.word;
        gloss = fromBank.gloss;
      } else {
        const inList = words.find((w) => w.word.toLowerCase() === raw);
        if (inList?.translation) {
          lemma = inList.word;
          gloss = inList.translation.split(/[；;，,]/)[0].trim().slice(0, 40);
        }
      }

      if (!gloss && settings.apiKey) {
        try {
          const info = await lookupWordInfo(raw, settings);
          if (info.lemma) lemma = info.lemma;
          if (info.translation) {
            gloss = info.translation.split(/[；;，,]/)[0].trim().slice(0, 40);
          }
        } catch {
          /* ignore */
        }
      }

      if (!gloss) {
        message.warning('未能自动补全释义，请检查拼写或配置 API Key');
        return;
      }

      const item: RelatedWord = {
        word: lemma,
        gloss,
      };
      await updateWord({ ...word!, similars: [...existing, item] });
      setSimilarInput('');
      setShowSimilarAdd(false);
      message.success(`已添加形近「${lemma}」`);
    } finally {
      setBusyAddSimilar(false);
    }
  }

  async function fillMnemonic() {
    if (!settings.apiKey) {
      message.warning('请先在设置里填 API Key');
      return;
    }
    setBusyMnemonic(true);
    try {
      const tip = await generateMnemonicTip(word!.word, settings);
      if (!tip) {
        message.warning('未生成助记，请重试');
        return;
      }
      await updateWord({ ...word!, mnemonic: tip });
      message.success('已生成助记');
    } catch (e) {
      message.error('生成失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setBusyMnemonic(false);
    }
  }

  async function fillCollocations() {
    if (!settings.apiKey) {
      message.warning('请先在设置里填 API Key');
      return;
    }
    setBusyCollocations(true);
    try {
      const list = await generateCollocations(
        word!.word,
        word!.translation || '',
        settings
      );
      if (!list.length) {
        message.warning('未生成到搭配，请重试');
        return;
      }
      // 合并：保留用户手记，不覆盖已有短语
      const existing = word!.collocations || [];
      const seen = new Set(existing.map((c) => c.phrase.toLowerCase()));
      const merged = [...existing];
      for (const c of list) {
        const k = c.phrase.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(c);
      }
      await updateWord({ ...word!, collocations: merged });
      message.success(
        existing.length
          ? `已补充 ${merged.length - existing.length} 条（保留原有手记）`
          : `已生成 ${merged.length} 条固定搭配`
      );
    } catch (e) {
      message.error('生成失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setBusyCollocations(false);
    }
  }

  async function removeCollocation(phrase: string) {
    const next = (word!.collocations || []).filter(
      (c) => c.phrase.toLowerCase() !== phrase.toLowerCase()
    );
    await updateWord({ ...word!, collocations: next });
    message.success('已移除该搭配');
  }

  async function addCollocation() {
    const phrase = coloPhrase.trim().replace(/\s+/g, ' ');
    if (!phrase || phrase.length < 2) {
      message.warning('请输入搭配短语');
      return;
    }
    const existing = word!.collocations || [];
    if (existing.some((c) => c.phrase.toLowerCase() === phrase.toLowerCase())) {
      message.warning('已有这条搭配');
      return;
    }
    setBusyAddColo(true);
    try {
      const item: Collocation = {
        phrase,
        gloss: coloGloss.trim().slice(0, 40),
      };
      await updateWord({ ...word!, collocations: [...existing, item] });
      setColoPhrase('');
      setColoGloss('');
      setShowColoAdd(false);
      message.success('已添加搭配');
    } finally {
      setBusyAddColo(false);
    }
  }

  async function toggleStarred() {
    await updateWord({ ...word!, starred: !word!.starred });
    message.success(word!.starred ? '已取消星标' : '已加星标');
  }

  async function toggleCrossed() {
    await updateWord({ ...word!, crossedOut: !word!.crossedOut });
    message.success(word!.crossedOut ? '已恢复' : '已划掉');
  }

  async function handleDelete() {
    const goId = nextWord?.id || prevWord?.id;
    await removeWord(word!.id);
    message.success('已删除');
    if (goId) {
      navigate(wordDetailPath(goId), {
        replace: true,
        state: wordDetailBrowseState(detailNav),
      });
    } else navigate('/words', { replace: true });
  }

  function goPrev() {
    if (prevWord) {
      navigate(wordDetailPath(prevWord), {
        replace: true,
        state: wordDetailBrowseState(detailNav),
      });
    }
  }

  function goNext() {
    if (nextWord) {
      navigate(wordDetailPath(nextWord), {
        replace: true,
        state: wordDetailBrowseState(detailNav),
      });
    }
  }

  function handleBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    const target = resolveWordDetailBack(detailNav, idx);
    if (target.type === 'back') navigate(-1);
    else navigate(target.path);
  }

  return (
    <div className="word-detail-page">
      <nav className="wd-navbar">
        <button
          type="button"
          className="wd-navbar-back"
          aria-label="返回"
          onClick={handleBack}
        >
          <LeftOutlined />
        </button>
        <h1 className={`wd-navbar-title${word.crossedOut ? ' crossed' : ''}`}>
          {word.starred ? <span className="wd-star-mark" aria-hidden>★ </span> : null}
          {word.word}
        </h1>
        <span className={`wd-navbar-stage ${wordStageClass(stage)}`}>
          {wordStageLabel(stage)}
        </span>
      </nav>

      <header className={`wd-hero${word.crossedOut ? ' crossed' : ''}`}>
        <div className="wd-hero-phonetic">
          <PhoneticDisplay word={word} withSpeak />
          {!word.phoneticUs && !word.phoneticUk && !word.phonetic && (
            <span className="text-light" style={{ fontSize: 12 }}>
              暂无音标
            </span>
          )}
        </div>
        <p className="wd-hero-meaning">
          {word.partOfSpeech ? <span className="wd-pos">{word.partOfSpeech}</span> : null}
          {word.translation || '暂无释义'}
        </p>
      </header>

      <div className="app-card">
        <WordCategoryEditor
          value={normalizeCategories(word.category)}
          onChange={async (next) => {
            await updateWord({ ...word, category: next });
            message.success(next.length ? '已更新分组' : '已清空分组');
          }}
        />
      </div>

      <div className="app-card wd-tab-card">
        <div className="wd-tabs" role="tablist">
          {(
            [
              { key: 'mnemonic', label: '助记' },
              { key: 'synonyms', label: '近义' },
              { key: 'similars', label: '形近' },
              { key: 'derivatives', label: '派生' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tipTab === t.key}
              className={`wd-tab ${tipTab === t.key ? 'active' : ''}`}
              onClick={() => setTipTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="wd-tab-body">
          {tipTab === 'mnemonic' && (
            <>
              <div className="tip-section-head" style={{ marginBottom: 8 }}>
                <span className="text-light" style={{ fontSize: 12 }}>
                  词根词缀 / 联想 / 笔记
                </span>
                <Space size={8}>
                  {!editingMnemonic && (
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={startEditMnemonic}
                    >
                      编辑
                    </Button>
                  )}
                  {!word.mnemonic && !editingMnemonic && (
                    <Button size="small" loading={busyMnemonic} onClick={fillMnemonic}>
                      AI 生成
                    </Button>
                  )}
                  {editingMnemonic && (
                    <>
                      <Button
                        size="small"
                        onClick={() => {
                          setEditingMnemonic(false);
                          setMnemonicDraft('');
                        }}
                      >
                        取消
                      </Button>
                      <Button
                        size="small"
                        type="primary"
                        loading={busySaveMnemonic}
                        onClick={saveMnemonic}
                      >
                        保存
                      </Button>
                    </>
                  )}
                </Space>
              </div>
              {editingMnemonic ? (
                <Input.TextArea
                  value={mnemonicDraft}
                  onChange={(e) => setMnemonicDraft(e.target.value)}
                  placeholder="写下助记、词根拆解或阅读笔记…"
                  autoSize={{ minRows: 4, maxRows: 12 }}
                  disabled={busySaveMnemonic}
                  autoFocus
                />
              ) : word.mnemonic ? (
                <div className="wd-mnemonic-body">{word.mnemonic}</div>
              ) : (
                <p className="text-light" style={{ fontSize: 13, margin: 0 }}>
                  还没有助记，可点「编辑」写笔记，或「AI 生成」
                </p>
              )}
            </>
          )}

          {tipTab === 'synonyms' && (
            <>
              <div className="tip-section-head" style={{ marginBottom: 8 }}>
                <span className="text-light" style={{ fontSize: 12 }}>
                  近义词（有道+AI · 可增删）
                </span>
                <Space size={8}>
                  {synonymDiff.trigger}
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => setShowSynonymAdd((v) => !v)}
                  >
                    {showSynonymAdd ? '取消' : '添加'}
                  </Button>
                  {!synonyms.length && (
                    <Button size="small" loading={busyRelated} onClick={fillRelated}>
                      补全
                    </Button>
                  )}
                </Space>
              </div>
              <RelatedWordsList
                items={synonyms}
                emptyText="暂无近义词，可点「补全」或「添加」"
                onRemove={removeSynonym}
                removeTitle="移除这个近义词"
                onAddToBank={addRelatedToBank}
                addingKey={addingKey}
                justAddedKey={justAddedKey}
                linkNavState={wordDetailDrillLinkState(detailNav)}
              />
              {synonymDiff.panel}
              {showSynonymAdd && (
                <Space.Compact style={{ width: '100%', marginTop: 10 }}>
                  <Input
                    size="small"
                    placeholder="输入近义词，AI 判断是否合适"
                    value={synonymInput}
                    onChange={(e) => setSynonymInput(e.target.value)}
                    onPressEnter={() => !busyAddSynonym && addSynonym()}
                    disabled={busyAddSynonym}
                    allowClear
                    autoFocus
                  />
                  <Button
                    size="small"
                    type="primary"
                    loading={busyAddSynonym}
                    onClick={addSynonym}
                  >
                    确认
                  </Button>
                </Space.Compact>
              )}
              {(synonyms.length > 0 || similars.length > 0) && (
                <Button
                  size="small"
                  type="link"
                  loading={busyRelated}
                  onClick={fillRelated}
                  style={{ paddingLeft: 0, marginTop: 8 }}
                >
                  重新补全近义 / 形近
                </Button>
              )}
            </>
          )}

          {tipTab === 'similars' && (
            <>
              <div className="tip-section-head" style={{ marginBottom: 8 }}>
                <span className="text-light" style={{ fontSize: 12 }}>
                  形近词（词库 · 不准可删）
                </span>
                <Space size={8}>
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => setShowSimilarAdd((v) => !v)}
                  >
                    {showSimilarAdd ? '取消' : '添加'}
                  </Button>
                  {!similars.length && (
                    <Button size="small" loading={busyRelated} onClick={fillRelated}>
                      补全
                    </Button>
                  )}
                </Space>
              </div>
              <RelatedWordsList
                items={similars}
                emptyText="暂无形近词，可点「补全」或「添加」"
                onRemove={removeSimilar}
                removeTitle="不需要这个形近词"
                linkNavState={wordDetailDrillLinkState(detailNav)}
              />
              {showSimilarAdd && (
                <Space.Compact style={{ width: '100%', marginTop: 10 }}>
                  <Input
                    size="small"
                    placeholder="输入形近词，自动补全意思"
                    value={similarInput}
                    onChange={(e) => setSimilarInput(e.target.value)}
                    onPressEnter={() => !busyAddSimilar && addSimilar()}
                    disabled={busyAddSimilar}
                    allowClear
                    autoFocus
                  />
                  <Button
                    size="small"
                    type="primary"
                    loading={busyAddSimilar}
                    onClick={addSimilar}
                  >
                    确认
                  </Button>
                </Space.Compact>
              )}
              {(synonyms.length > 0 || similars.length > 0) && (
                <Button
                  size="small"
                  type="link"
                  loading={busyRelated}
                  onClick={fillRelated}
                  style={{ paddingLeft: 0, marginTop: 8 }}
                >
                  重新补全近义 / 形近
                </Button>
              )}
            </>
          )}

          {tipTab === 'derivatives' && (
            <>
              <div className="tip-section-head" style={{ marginBottom: 8 }}>
                <span className="text-light" style={{ fontSize: 12 }}>
                  同根派生（词典）
                </span>
              </div>
              <DerivativesList
                items={derivatives}
                emptyText="词库暂无该词的派生词"
              />
            </>
          )}
        </div>
      </div>

      <div className="app-card wd-tab-card">
        <div className="wd-tabs" role="tablist">
          {(
            [
              { key: 'dict', label: '词典搭配' },
              { key: 'mine', label: '固定搭配' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={coloTab === t.key}
              className={`wd-tab ${coloTab === t.key ? 'active' : ''}`}
              onClick={() => setColoTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="wd-tab-body">
          {coloTab === 'dict' && (
            <>
              <p className="text-light" style={{ fontSize: 12, margin: '0 0 8px' }}>
                来自有道词组
              </p>
              <CollocationsList
                items={dictCollocations}
                emptyText="词库暂无该词的词典搭配"
                deckPhraseKeys={deckPhraseKeys}
                onAddToDeck={async (item) => {
                  const { existed, chunk } = await addFromCollocation({
                    phrase: item.phrase,
                    gloss: item.gloss,
                    anchorWordId: word?.id,
                    source: 'dict',
                  });
                  message.success(existed ? '已在搭配本' : '已加入搭配本');
                  if (existed) navigate(`/chunks/${chunk.id}`);
                }}
                onOpenInDeck={(phraseKey) => {
                  const cid = chunkIdByKey.get(phraseKey);
                  if (cid) navigate(`/chunks/${cid}`);
                }}
              />
            </>
          )}

          {coloTab === 'mine' && (
            <>
              <div className="tip-section-head" style={{ marginBottom: 8 }}>
                <span className="text-light" style={{ fontSize: 12 }}>
                  手记 / AI
                </span>
                <Space size={8}>
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => setShowColoAdd((v) => !v)}
                  >
                    {showColoAdd ? '取消' : '添加'}
                  </Button>
                  <Button size="small" loading={busyCollocations} onClick={fillCollocations}>
                    {collocations.length ? 'AI 补充' : 'AI 抓取'}
                  </Button>
                </Space>
              </div>
              <CollocationsList
                items={collocations}
                emptyText="暂无搭配，可手记或点「AI 抓取」"
                onRemove={removeCollocation}
                removeTitle="删除这条搭配"
                deckPhraseKeys={deckPhraseKeys}
                onAddToDeck={async (item) => {
                  const { existed, chunk } = await addFromCollocation({
                    phrase: item.phrase,
                    gloss: item.gloss,
                    anchorWordId: word?.id,
                    source: 'manual',
                  });
                  message.success(existed ? '已在搭配本' : '已加入搭配本');
                  if (existed) navigate(`/chunks/${chunk.id}`);
                }}
                onOpenInDeck={(phraseKey) => {
                  const cid = chunkIdByKey.get(phraseKey);
                  if (cid) navigate(`/chunks/${cid}`);
                }}
              />
              {showColoAdd && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Input
                    size="small"
                    placeholder="英文搭配，如 feel elated"
                    value={coloPhrase}
                    onChange={(e) => setColoPhrase(e.target.value)}
                    onPressEnter={() => !busyAddColo && addCollocation()}
                    disabled={busyAddColo}
                    allowClear
                    autoFocus
                  />
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      size="small"
                      placeholder="中文意思（可选）"
                      value={coloGloss}
                      onChange={(e) => setColoGloss(e.target.value)}
                      onPressEnter={() => !busyAddColo && addCollocation()}
                      disabled={busyAddColo}
                      allowClear
                    />
                    <Button
                      size="small"
                      type="primary"
                      loading={busyAddColo}
                      onClick={addCollocation}
                    >
                      确认
                    </Button>
                  </Space.Compact>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {examples.length > 0 && (
        <div className="app-card">
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>例句</h3>
          {examples.map((ex, i) => (
            <div key={i} style={{ marginBottom: i < examples.length - 1 ? 14 : 0 }}>
              <MarkableSentence text={ex.en} className="practice-ref-sentence" />
              {ex.zh && (
                <div className="text-light" style={{ fontSize: 13, marginTop: 4 }}>
                  {ex.zh}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="app-card">
        <CollapsibleTip
          title="学习进度 · 艾宾浩斯"
          sectionKey={`progress:${word.id}`}
          defaultOpen={false}
        >
          <p className="text-light" style={{ fontSize: 13, marginBottom: 12 }}>
            {ladderProgressLabel(word)}
            {retention == null ? null : ` · 记忆残留约 ${Math.round(retention * 100)}%`}
          </p>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="num">{word.totalReviews}</div>
              <div className="label">复习次数</div>
            </div>
            <div className="stat-card">
              <div className="num">{accuracy == null ? '—' : `${accuracy}%`}</div>
              <div className="label">正确率</div>
            </div>
            <div className="stat-card">
              <div className="num" style={{ fontSize: 14 }}>
                {formatReviewInterval(
                  Math.max(0, (word.interval || 0) * 24 * 60 * 60 * 1000)
                )}
              </div>
              <div className="label">当前间隔</div>
            </div>
            <div className="stat-card">
              <div className="num" style={{ fontSize: 14 }}>
                {formatNextReview(word.nextReview)}
              </div>
              <div className="label">下次复习</div>
            </div>
          </div>
        </CollapsibleTip>
      </div>

      <nav className="wd-bottom-bar" aria-label="词详情操作">
        <button
          type="button"
          className="wd-bar-btn"
          disabled={!prevWord}
          onClick={goPrev}
          title="上一个"
          aria-label="上一个"
        >
          <LeftOutlined />
        </button>
        <button
          type="button"
          className="wd-bar-btn"
          disabled={!nextWord}
          onClick={goNext}
          title="下一个"
          aria-label="下一个"
        >
          <RightOutlined />
        </button>
        <button
          type="button"
          className={`wd-bar-btn${word.starred ? ' is-starred' : ''}`}
          onClick={toggleStarred}
          title={word.starred ? '取消星标' : '加星标'}
          aria-label={word.starred ? '取消星标' : '加星标'}
        >
          {word.starred ? <StarFilled /> : <StarOutlined />}
        </button>
        <button
          type="button"
          className="wd-bar-btn"
          onClick={toggleCrossed}
          title={word.crossedOut ? '恢复' : '划掉'}
          aria-label={word.crossedOut ? '恢复' : '划掉'}
        >
          {word.crossedOut ? <UndoOutlined /> : <MinusOutlined />}
        </button>
        <Popconfirm
          title="确定删除这个词？"
          onConfirm={handleDelete}
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
        >
          <button
            type="button"
            className="wd-bar-btn danger"
            title="删除"
            aria-label="删除"
          >
            <CloseOutlined />
          </button>
        </Popconfirm>
        <button
          type="button"
          className="wd-bar-primary"
          onClick={() => navigate('/today')}
          title="去学习"
          aria-label="去学习"
        >
          <ReadOutlined />
        </button>
      </nav>
    </div>
  );
}
