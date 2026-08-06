import { useMemo, useState } from 'react';
import { Button, Input, Modal, Segmented, App } from 'antd';
import { PlusOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useChunksStore, useChunksWithProgress, useChunkDueStats } from '@/store/useChunks';
import { useFramesStore, useFramesWithProgress, useFrameDueStats, FRAME_PACK } from '@/store/useFrames';
import { formatNextReview, isDue, isMastered, isNew } from '@/utils/scheduler';
import { wordDetailPath } from '@/utils/wordId';
import { normalizeFrameKey } from '@/types/frame';

type Tab = 'chunks' | 'frames';
type Filter = 'all' | 'due' | 'new' | 'learning' | 'mastered' | 'starred';

export default function ChunksPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('chunks');
  const [filter, setFilter] = useState<Filter>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [gloss, setGloss] = useState('');

  const chunks = useChunksWithProgress();
  const frames = useFramesWithProgress();
  const chunkStats = useChunkDueStats();
  const frameStats = useFrameDueStats();
  const addFromCollocation = useChunksStore((s) => s.addFromCollocation);
  const addFromPack = useFramesStore((s) => s.addFromPack);

  const filteredChunks = useMemo(() => {
    let list = chunks.filter((c) => !c.progress.crossedOut || filter === 'all');
    if (filter === 'due') {
      list = list.filter((c) => !isNew(c.progress) && isDue(c.progress));
    } else if (filter === 'new') list = list.filter((c) => isNew(c.progress));
    else if (filter === 'mastered') list = list.filter((c) => isMastered(c.progress));
    else if (filter === 'learning') {
      list = list.filter(
        (c) => !isNew(c.progress) && !isDue(c.progress) && !isMastered(c.progress)
      );
    } else if (filter === 'starred') list = list.filter((c) => c.progress.starred);
    return [...list].sort((a, b) => a.progress.nextReview - b.progress.nextReview);
  }, [chunks, filter]);

  const filteredFrames = useMemo(() => {
    let list = frames.filter((f) => !f.progress.crossedOut || filter === 'all');
    if (filter === 'due') {
      list = list.filter((f) => !isNew(f.progress) && isDue(f.progress));
    } else if (filter === 'new') list = list.filter((f) => isNew(f.progress));
    else if (filter === 'mastered') list = list.filter((f) => isMastered(f.progress));
    else if (filter === 'learning') {
      list = list.filter(
        (f) => !isNew(f.progress) && !isDue(f.progress) && !isMastered(f.progress)
      );
    } else if (filter === 'starred') list = list.filter((f) => f.progress.starred);
    return [...list].sort((a, b) => a.progress.nextReview - b.progress.nextReview);
  }, [frames, filter]);

  const stats = tab === 'chunks' ? chunkStats : frameStats;

  async function handleAddChunk() {
    if (!phrase.trim()) {
      message.warning('请填写英文搭配');
      return;
    }
    const { existed } = await addFromCollocation({
      phrase: phrase.trim(),
      gloss: gloss.trim(),
      source: 'manual',
    });
    message.success(existed ? '已在搭配本' : '已加入搭配本');
    setAddOpen(false);
    setPhrase('');
    setGloss('');
  }

  async function handleAddPackItem(packTitle: string) {
    const item = FRAME_PACK.find((x) => x.title === packTitle);
    if (!item) return;
    const { existed, frame } = await addFromPack(item);
    message.success(existed ? '已在模板本' : '已加入模板本');
    if (!existed) navigate(`/frames/${frame.id}`);
  }

  return (
    <div className="page-pad">
      <div className="app-card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>搭配</h2>
          {tab === 'chunks' ? (
            <Button size="small" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
              添加
            </Button>
          ) : null}
        </div>
        <p className="text-light" style={{ fontSize: 13, margin: '8px 0 12px' }}>
          到期 {stats.due} · 本库 {stats.total}
          {tab === 'chunks' ? ` · 未练 ${stats.fresh}` : ` · 未练 ${stats.fresh}`}
        </p>
        <Segmented
          block
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { label: '语块', value: 'chunks' },
            { label: '模板', value: 'frames' },
          ]}
        />
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            disabled={stats.total === 0}
            onClick={() =>
              navigate(
                tab === 'chunks'
                  ? '/practice?deck=chunk&scope=mixed'
                  : '/practice?deck=frame&scope=mixed'
              )
            }
          >
            开始复习
          </Button>
          <Button
            disabled={stats.due === 0}
            onClick={() =>
              navigate(
                tab === 'chunks'
                  ? '/practice?deck=chunk&scope=review'
                  : '/practice?deck=frame&scope=review'
              )
            }
          >
            只练到期
          </Button>
        </div>
      </div>

      <div className="filter-chips" style={{ marginBottom: 10 }}>
        {(
          [
            ['all', '全部'],
            ['due', '到期'],
            ['new', '未练'],
            ['learning', '学习中'],
            ['mastered', '已掌握'],
            ['starred', '星标'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`chip ${filter === k ? 'active' : ''}`}
            onClick={() => setFilter(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'chunks' ? (
        filteredChunks.length === 0 ? (
          <div className="app-card empty">
            <p>搭配本还是空的</p>
            <p className="text-light" style={{ fontSize: 13 }}>
              从词详情点搭配旁的「加入」，或点右上角添加
            </p>
          </div>
        ) : (
          <ul className="deck-list">
            {filteredChunks.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="deck-list-item"
                  onClick={() => navigate(`/chunks/${c.id}`)}
                >
                  <div>
                    <b>{c.phrase}</b>
                    {c.gloss ? (
                      <span className="text-light"> {c.gloss}</span>
                    ) : null}
                  </div>
                  <div className="text-light" style={{ fontSize: 12, marginTop: 4 }}>
                    {isNew(c.progress)
                      ? '未开始'
                      : formatNextReview(c.progress.nextReview)}
                    {c.anchorWordId ? (
                      <>
                        {' · '}
                        <span
                          role="link"
                          tabIndex={0}
                          className="deck-anchor-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(wordDetailPath(c.anchorWordId!));
                          }}
                        >
                          {c.anchorWordId}
                        </span>
                      </>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          {filteredFrames.length === 0 ? (
            <div className="app-card empty" style={{ marginBottom: 12 }}>
              <p>尚未收藏模板</p>
              <p className="text-light" style={{ fontSize: 13 }}>
                从下方预制包加入后即可复习
              </p>
            </div>
          ) : (
            <ul className="deck-list" style={{ marginBottom: 16 }}>
              {filteredFrames.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="deck-list-item"
                    onClick={() => navigate(`/frames/${f.id}`)}
                  >
                    <div>
                      <b>{f.title}</b>
                      {f.glossZh ? (
                        <span className="text-light"> {f.glossZh}</span>
                      ) : null}
                    </div>
                    <div className="text-light" style={{ fontSize: 12, marginTop: 4 }}>
                      {isNew(f.progress)
                        ? '未开始'
                        : formatNextReview(f.progress.nextReview)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="app-card">
            <h3 style={{ marginTop: 0 }}>预制包 · 写作核心句型</h3>
            <ul className="deck-list">
              {FRAME_PACK.map((item) => {
                const owned = frames.some(
                  (f) => f.frameKey === normalizeFrameKey(item.skeleton)
                );
                return (
                  <li key={item.title} className="deck-pack-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{item.title}</b>
                      <div className="text-light" style={{ fontSize: 12 }}>
                        {item.skeleton}
                      </div>
                    </div>
                    <Button
                      size="small"
                      disabled={owned}
                      onClick={() => handleAddPackItem(item.title)}
                    >
                      {owned ? '已加入' : '加入'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      <Modal
        title="添加语块"
        open={addOpen}
        onOk={() => void handleAddChunk()}
        onCancel={() => setAddOpen(false)}
        okText="加入搭配本"
      >
        <Input
          placeholder="英文搭配，如 take into account"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <Input
          placeholder="中文释义（可选）"
          value={gloss}
          onChange={(e) => setGloss(e.target.value)}
        />
      </Modal>
    </div>
  );
}
