import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, App, Popconfirm } from 'antd';
import { SoundOutlined, LeftOutlined } from '@ant-design/icons';
import { useUserWords, useWordsStore } from '@/store/useWords';
import { useSettings } from '@/store/useSettings';
import {
  getWordStage,
  wordStageLabel,
  wordStageClass,
} from '@/utils/scheduler';
import {
  generateMnemonicTip,
  generateRelatedWords,
} from '@/api/llm';
import RelatedWordsList from '@/components/RelatedWordsList';
import MarkableSentence from '@/components/MarkableSentence';

export default function WordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const words = useUserWords();
  const updateWord = useWordsStore((s) => s.updateWord);
  const removeWord = useWordsStore((s) => s.removeWord);
  const settings = useSettings();

  const word = useMemo(() => words.find((w) => w.id === id), [words, id]);
  const [busyRelated, setBusyRelated] = useState(false);
  const [busyMnemonic, setBusyMnemonic] = useState(false);

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
  const examples = (word.examples || []).filter((ex) => ex?.en).slice(0, 3);
  const accuracy =
    word.totalReviews > 0
      ? Math.round((word.correctReviews / word.totalReviews) * 100)
      : null;

  function speak() {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word!.word);
    u.lang = 'en-US';
    window.speechSynthesis.speak(u);
  }

  async function fillRelated() {
    if (!settings.apiKey) {
      message.warning('请先在设置里填 API Key');
      return;
    }
    setBusyRelated(true);
    try {
      const related = await generateRelatedWords(
        word!.word,
        word!.translation || '',
        settings
      );
      await updateWord({
        ...word!,
        synonyms: related.synonyms,
        similars: related.similars,
      });
      if (!related.synonyms.length && !related.similars.length) {
        message.warning('未生成到相关词，请重试');
      } else {
        message.success('已补全近义 / 形近词');
      }
    } catch (e) {
      message.error('生成失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setBusyRelated(false);
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

  async function toggleCrossed() {
    await updateWord({ ...word!, crossedOut: !word!.crossedOut });
    message.success(word!.crossedOut ? '已恢复' : '已划掉');
  }

  async function handleDelete() {
    await removeWord(word!.id);
    message.success('已删除');
    navigate('/words');
  }

  return (
    <div>
      <div className="app-header" style={{ textAlign: 'left' }}>
        <Button
          type="text"
          icon={<LeftOutlined />}
          onClick={() => navigate('/words')}
          style={{ paddingLeft: 0, marginBottom: 8 }}
        >
          词表
        </Button>
        <div className="word-row" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontFamily: 'Georgia, serif' }}>{word.word}</h1>
          <button type="button" className="speak-btn" title="发音" onClick={speak}>
            <SoundOutlined />
          </button>
          <span className={wordStageClass(stage)}>{wordStageLabel(stage)}</span>
        </div>
        <p style={{ marginTop: 6 }}>
          {word.phonetic || '暂无音标'}
          {word.partOfSpeech ? ` · ${word.partOfSpeech}` : ''}
        </p>
      </div>

      <div className="app-card">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>释义</h3>
        <div style={{ lineHeight: 1.7 }}>{word.translation || '暂无释义'}</div>
      </div>

      <div className="app-card">
        <div className="tip-section-head" style={{ marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>助记 · 词根词缀</h3>
          {!word.mnemonic && (
            <Button size="small" loading={busyMnemonic} onClick={fillMnemonic}>
              AI 生成
            </Button>
          )}
        </div>
        {word.mnemonic ? (
          <div style={{ lineHeight: 1.65 }}>{word.mnemonic}</div>
        ) : (
          <p className="text-light" style={{ fontSize: 13, margin: 0 }}>
            还没有助记，可点「AI 生成」
          </p>
        )}
      </div>

      <div className="app-card">
        <div className="tip-section-head" style={{ marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>近义词</h3>
          {!synonyms.length && (
            <Button size="small" loading={busyRelated} onClick={fillRelated}>
              AI 补全
            </Button>
          )}
        </div>
        <RelatedWordsList items={synonyms} emptyText="暂无近义词，可点「AI 补全」" />
      </div>

      <div className="app-card">
        <div className="tip-section-head" style={{ marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>形近词</h3>
          {!similars.length && (
            <Button size="small" loading={busyRelated} onClick={fillRelated}>
              AI 补全
            </Button>
          )}
        </div>
        <RelatedWordsList items={similars} emptyText="暂无形近词，可点「AI 补全」" />
        {(synonyms.length > 0 || similars.length > 0) && (
          <Button
            size="small"
            type="link"
            loading={busyRelated}
            onClick={fillRelated}
            style={{ paddingLeft: 0, marginTop: 8 }}
          >
            重新生成近义 / 形近
          </Button>
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
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>学习进度</h3>
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
            <div className="num">{word.interval}</div>
            <div className="label">间隔(天)</div>
          </div>
          <div className="stat-card">
            <div className="num" style={{ fontSize: 14 }}>
              {new Date(word.nextReview).toLocaleDateString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
              })}
            </div>
            <div className="label">下次复习</div>
          </div>
        </div>
      </div>

      <div className="word-detail-actions">
        <Button onClick={toggleCrossed}>{word.crossedOut ? '恢复' : '划掉'}</Button>
        <Popconfirm
          title="确定删除这个词？"
          onConfirm={handleDelete}
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
        >
          <Button danger>删除</Button>
        </Popconfirm>
        <Button type="primary" onClick={() => navigate('/today')}>
          去练习
        </Button>
      </div>
    </div>
  );
}
