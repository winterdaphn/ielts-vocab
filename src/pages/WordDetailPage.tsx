import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, App, Popconfirm, Input, Space } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  StopOutlined,
  DeleteOutlined,
  ReadOutlined,
  PlusOutlined,
  EditOutlined,
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
} from '@/api/llm';
import { getRelatedFromBank, mergeRelatedLists, resolveBankGloss } from '@/utils/vocabBankRelated';
import RelatedWordsList from '@/components/RelatedWordsList';
import CollocationsList from '@/components/CollocationsList';
import MarkableSentence from '@/components/MarkableSentence';
import PhoneticDisplay from '@/components/PhoneticDisplay';
import CollapsibleTip from '@/components/practice/CollapsibleTip';
import type { Collocation, RelatedWord } from '@/types/word';
import WordCategoryEditor from '@/components/WordCategoryEditor';
import { normalizeCategories } from '@/config/categories';

type TipTab = 'mnemonic' | 'synonyms' | 'similars';

export default function WordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const words = useUserWords();
  const updateWord = useWordsStore((s) => s.updateWord);
  const removeWord = useWordsStore((s) => s.removeWord);
  const settings = useSettings();

  const idx = useMemo(() => words.findIndex((w) => w.id === id), [words, id]);
  const word = idx >= 0 ? words[idx] : undefined;
  const prevWord = idx > 0 ? words[idx - 1] : null;
  const nextWord = idx >= 0 && idx < words.length - 1 ? words[idx + 1] : null;

  const [tipTab, setTipTab] = useState<TipTab>('mnemonic');
  const [busyRelated, setBusyRelated] = useState(false);
  const [busyMnemonic, setBusyMnemonic] = useState(false);
  const [busyCollocations, setBusyCollocations] = useState(false);
  const [similarInput, setSimilarInput] = useState('');
  const [busyAddSimilar, setBusyAddSimilar] = useState(false);
  const [showSimilarAdd, setShowSimilarAdd] = useState(false);
  const [coloPhrase, setColoPhrase] = useState('');
  const [coloGloss, setColoGloss] = useState('');
  const [busyAddColo, setBusyAddColo] = useState(false);
  const [showColoAdd, setShowColoAdd] = useState(false);
  const [editingMnemonic, setEditingMnemonic] = useState(false);
  const [mnemonicDraft, setMnemonicDraft] = useState('');
  const [busySaveMnemonic, setBusySaveMnemonic] = useState(false);

  // 切换词条时退出编辑态
  useEffect(() => {
    setEditingMnemonic(false);
    setMnemonicDraft('');
    setShowSimilarAdd(false);
    setShowColoAdd(false);
  }, [id]);

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
  const collocations = word.collocations || [];
  const examples = (word.examples || []).filter((ex) => ex?.en).slice(0, 3);
  const accuracy =
    word.totalReviews > 0
      ? Math.round((word.correctReviews / word.totalReviews) * 100)
      : null;
  const retention = estimateRetention(word);

  async function fillRelated() {
    setBusyRelated(true);
    try {
      const fromBank = getRelatedFromBank(word!.word, word!.translation || '');
      let synonyms = fromBank.synonyms;
      // 形近：仅词库；若用户已改过（有列表），补全时不覆盖，避免删掉的又回来
      const existingSim = word!.similars || [];
      const similars = existingSim.length ? existingSim : fromBank.similars;

      if (settings.apiKey) {
        try {
          const fromAi = await generateRelatedWords(
            word!.word,
            word!.translation || '',
            settings
          );
          synonyms = mergeRelatedLists(fromBank.synonyms, fromAi.synonyms, 6);
        } catch {
          /* keep bank synonyms */
        }
      }

      await updateWord({
        ...word!,
        synonyms,
        similars,
      });

      if (!synonyms.length && !similars.length) {
        message.warning(
          settings.apiKey
            ? '暂未补全到近义 / 形近'
            : '词库暂无；配置 API Key 后可再抓近义词'
        );
      } else {
        const aiNote = settings.apiKey ? '（近义含 AI）' : '（仅词库；配 Key 可加强近义）';
        message.success(
          `已补全 · 近义 ${synonyms.length} · 形近 ${similars.length} ${aiNote}`
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
        note: '',
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

  async function toggleCrossed() {
    await updateWord({ ...word!, crossedOut: !word!.crossedOut });
    message.success(word!.crossedOut ? '已恢复' : '已划掉');
  }

  async function handleDelete() {
    const goId = nextWord?.id || prevWord?.id;
    await removeWord(word!.id);
    message.success('已删除');
    if (goId) navigate(`/words/${goId}`, { replace: true });
    else navigate('/words', { replace: true });
  }

  function goPrev() {
    if (prevWord) navigate(`/words/${prevWord.id}`);
  }

  function goNext() {
    if (nextWord) navigate(`/words/${nextWord.id}`);
  }

  return (
    <div className="word-detail-page">
      <nav className="wd-navbar">
        <button
          type="button"
          className="wd-navbar-back"
          aria-label="返回词表"
          onClick={() => navigate('/words')}
        >
          <LeftOutlined />
        </button>
        <h1 className={`wd-navbar-title${word.crossedOut ? ' crossed' : ''}`}>{word.word}</h1>
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
                  近义词（词库 + AI）
                </span>
                {!synonyms.length && (
                  <Button size="small" loading={busyRelated} onClick={fillRelated}>
                    补全
                  </Button>
                )}
              </div>
              <RelatedWordsList items={synonyms} emptyText="暂无近义词，可点「补全」" />
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
        </div>
      </div>

      <div className="app-card">
        <div className="tip-section-head" style={{ marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>固定搭配</h3>
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
        >
          <LeftOutlined />
          <span>上一个</span>
        </button>
        <button
          type="button"
          className="wd-bar-btn"
          disabled={!nextWord}
          onClick={goNext}
        >
          <RightOutlined />
          <span>下一个</span>
        </button>
        <button type="button" className="wd-bar-btn" onClick={toggleCrossed}>
          <StopOutlined />
          <span>{word.crossedOut ? '恢复' : '划掉'}</span>
        </button>
        <Popconfirm
          title="确定删除这个词？"
          onConfirm={handleDelete}
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
        >
          <button type="button" className="wd-bar-btn danger">
            <DeleteOutlined />
            <span>删除</span>
          </button>
        </Popconfirm>
        <button
          type="button"
          className="wd-bar-primary"
          onClick={() => navigate('/today')}
        >
          <ReadOutlined />
          <span>去学习</span>
        </button>
      </nav>
    </div>
  );
}
