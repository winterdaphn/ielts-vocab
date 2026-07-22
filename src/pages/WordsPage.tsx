import { useState, useMemo } from 'react';
import { Popconfirm, App } from 'antd';
import { SoundOutlined } from '@ant-design/icons';
import { useUserWords, useWordsStore } from '@/store/useWords';
import { isDue, isNew, isMastered } from '@/utils/scheduler';
import type { Word } from '@/types/word';

type Filter = 'all' | 'due' | 'new' | 'learning' | 'mastered' | 'crossed';

function getWordStatus(w: Word): Filter {
  if (w.crossedOut) return 'crossed';
  if (isNew(w)) return 'new';
  if (isDue(w)) return 'due';
  if (isMastered(w)) return 'mastered';
  return 'learning';
}

const TAG_MAP: Record<string, { className: string; label: string }> = {
  new: { className: 'tag tag-new', label: '新词' },
  due: { className: 'tag tag-due', label: '待复习' },
  learning: { className: 'tag tag-due', label: '学习中' },
  mastered: { className: 'tag tag-mastered', label: '已掌握' },
  crossed: { className: 'tag tag-crossed', label: '已划掉' },
};

export default function WordsPage() {
  const { message } = App.useApp();
  const words = useUserWords();
  const [filter, setFilter] = useState<Filter>('all');
  const removeWord = useWordsStore((s) => s.removeWord);
  const updateWord = useWordsStore((s) => s.updateWord);

  const counts = useMemo(() => ({
    all: words.length,
    new: words.filter((w) => !w.crossedOut && isNew(w)).length,
    due: words.filter((w) => !w.crossedOut && isDue(w)).length,
    learning: words.filter((w) => !w.crossedOut && !isNew(w) && !isDue(w) && !isMastered(w)).length,
    mastered: words.filter((w) => !w.crossedOut && isMastered(w)).length,
    crossed: words.filter((w) => w.crossedOut).length,
  }), [words]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: `全部 (${counts.all})` },
    { key: 'new', label: `新词 (${counts.new})` },
    { key: 'due', label: `待复习 (${counts.due})` },
    { key: 'learning', label: `学习中 (${counts.learning})` },
    { key: 'mastered', label: `已掌握 (${counts.mastered})` },
    { key: 'crossed', label: `已划掉 (${counts.crossed})` },
  ];

  const filtered = useMemo(() => {
    if (filter === 'due') return words.filter((w) => !w.crossedOut && isDue(w));
    if (filter === 'new') return words.filter((w) => !w.crossedOut && isNew(w));
    if (filter === 'learning') {
      return words.filter((w) => !w.crossedOut && !isNew(w) && !isDue(w) && !isMastered(w));
    }
    if (filter === 'mastered') return words.filter((w) => !w.crossedOut && isMastered(w));
    if (filter === 'crossed') return words.filter((w) => w.crossedOut);
    return words;
  }, [words, filter]);

  async function toggleCrossed(w: Word) {
    const updated = { ...w, crossedOut: !w.crossedOut };
    await updateWord(updated);
    message.success(updated.crossedOut ? '已划掉' : '已恢复');
  }

  async function deleteWord(id: string) {
    await removeWord(id);
    message.success('已删除');
  }

  function speak(text: string, e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (!window.speechSynthesis) return;
    const btn = e.currentTarget;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    btn.classList.add('speaking');
    u.onend = () => btn.classList.remove('speaking');
    u.onerror = () => btn.classList.remove('speaking');
    window.speechSynthesis.speak(u);
  }

  return (
    <div>
      <div className="app-header">
        <h1>词表</h1>
        <p>共 {words.length} 个单词 · 单词 · 音标 · 发音 · 词语释义</p>
      </div>

      <div className="filter-tabs">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`filter-tab ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="app-card empty">
          <div className="empty-icon">📭</div>
          <h3>这里空空如也</h3>
          <p>{words.length === 0 ? '去「添加」加几个新词吧' : '切换其他分类看看'}</p>
        </div>
      ) : (
        filtered.map((w) => {
          const status = getWordStatus(w);
          const tag = TAG_MAP[status];
          return (
            <div key={w.id} className={`word-list-item ${w.crossedOut ? 'crossed' : ''}`}>
              <div className="word-main">
                <div className="word-row">
                  <span className="word">{w.word}</span>
                  {w.phonetic && <span className="phonetic">{w.phonetic}</span>}
                  <button
                    type="button"
                    className="speak-btn"
                    title="发音"
                    onClick={(e) => speak(w.word, e)}
                  >
                    <SoundOutlined />
                  </button>
                </div>
                <div className={`translation ${w.translation ? '' : 'mute'}`}>
                  {w.translation || '暂无翻译'}
                </div>
              </div>
              <div className="meta">
                <div className="tags">
                  {tag && <span className={tag.className}>{tag.label}</span>}
                </div>
                <div className="actions">
                  <button
                    type="button"
                    title={w.crossedOut ? '恢复' : '划掉'}
                    onClick={() => toggleCrossed(w)}
                  >
                    {w.crossedOut ? '↩' : '−'}
                  </button>
                  <Popconfirm
                    title="确定删除？"
                    onConfirm={() => deleteWord(w.id)}
                    okText="确定"
                    cancelText="取消"
                  >
                    <button type="button" className="delete" title="删除">✕</button>
                  </Popconfirm>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
