import { useMemo, useState } from 'react';
import { Button, Input, App, Popconfirm } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  CloseOutlined,
  StarOutlined,
  StarFilled,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useChunksStore, useChunksWithProgress } from '@/store/useChunks';
import ChunkExplanationView from '@/components/ChunkExplanationView';
import {
  formatNextReview,
  ladderProgressLabel,
  getWordStage,
  wordStageClass,
  wordStageLabel,
} from '@/utils/scheduler';
import { wordDetailPath } from '@/utils/wordId';
import {
  type WordDetailNavState,
  wordDetailBrowseState,
  wordDetailDrillLinkState,
  resolveWordDetailBack,
} from '@/utils/wordDetailNav';

export default function ChunkDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const detailNav = (location.state ?? null) as WordDetailNavState | null;
  const { message } = App.useApp();
  const items = useChunksWithProgress();
  const updateChunk = useChunksStore((s) => s.updateChunk);
  const updateProgress = useChunksStore((s) => s.updateProgress);
  const removeChunk = useChunksStore((s) => s.removeChunk);

  const sorted = useMemo(
    () =>
      [...items]
        .filter((c) => !c.progress.crossedOut)
        .sort((a, b) => a.progress.nextReview - b.progress.nextReview),
    [items]
  );
  const idx = useMemo(() => sorted.findIndex((c) => c.id === id), [sorted, id]);
  const chunk = idx >= 0 ? sorted[idx] : items.find((c) => c.id === id);
  const prevChunk = idx > 0 ? sorted[idx - 1] : null;
  const nextChunk = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  const [editing, setEditing] = useState(false);
  const [gloss, setGloss] = useState('');
  const [explanation, setExplanation] = useState('');

  function handleBack() {
    const historyIdx = (window.history.state as { idx?: number } | null)?.idx;
    const target = resolveWordDetailBack(detailNav, historyIdx, '/chunks');
    if (target.type === 'back') navigate(-1);
    else navigate(target.path);
  }

  if (!chunk) {
    return (
      <div className="page-pad">
        <div className="app-card empty">
          <p>找不到这条语块</p>
          <Button type="primary" onClick={handleBack}>
            返回搭配本
          </Button>
        </div>
      </div>
    );
  }

  const stage = getWordStage({
    ...chunk.progress,
    crossedOut: !!chunk.progress.crossedOut,
  });

  function startEdit() {
    setGloss(chunk!.gloss);
    setExplanation(chunk!.explanation || '');
    setEditing(true);
  }

  async function saveEdit() {
    await updateChunk({
      ...chunk!,
      gloss: gloss.trim(),
      explanation: explanation.trim(),
    });
    setEditing(false);
    message.success('已保存');
  }

  async function toggleStarred() {
    await updateProgress({
      ...chunk!.progress,
      starred: !chunk!.progress.starred,
    });
    message.success(chunk!.progress.starred ? '已取消星标' : '已加星标');
  }

  async function handleDelete() {
    const goId = nextChunk?.id || prevChunk?.id;
    await removeChunk(chunk!.id);
    message.success('已删除');
    if (goId) {
      navigate(`/chunks/${goId}`, {
        replace: true,
        state: wordDetailBrowseState(detailNav),
      });
    } else navigate('/chunks', { replace: true });
  }

  function goPrev() {
    if (prevChunk) {
      navigate(`/chunks/${prevChunk.id}`, {
        replace: true,
        state: wordDetailBrowseState(detailNav),
      });
    }
  }

  function goNext() {
    if (nextChunk) {
      navigate(`/chunks/${nextChunk.id}`, {
        replace: true,
        state: wordDetailBrowseState(detailNav),
      });
    }
  }

  return (
    <div className="word-detail-page">
      <nav className="wd-navbar">
        <button type="button" className="wd-navbar-back" aria-label="返回" onClick={handleBack}>
          <LeftOutlined />
        </button>
        <h1 className="wd-navbar-title">
          {chunk.progress.starred ? <span className="wd-star-mark" aria-hidden>★ </span> : null}
          {chunk.phrase}
        </h1>
        <span className={`wd-navbar-stage ${wordStageClass(stage)}`}>
          {wordStageLabel(stage)}
        </span>
      </nav>

      <div className="app-card" style={{ marginTop: 12 }}>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input value={gloss} onChange={(e) => setGloss(e.target.value)} placeholder="列表用短释义" />
            <Input.TextArea
              rows={10}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="AI 讲解（Markdown）"
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="primary" onClick={() => void saveEdit()}>
                保存
              </Button>
              <Button onClick={() => setEditing(false)}>取消</Button>
            </div>
          </div>
        ) : (
          <>
            {chunk.explanation?.trim() ? (
              <ChunkExplanationView text={chunk.explanation} />
            ) : (
              <>
                <p style={{ margin: '0 0 8px', fontSize: 16 }}>{chunk.gloss || '（无释义）'}</p>
                {chunk.exampleEn ? (
                  <p style={{ margin: '0 0 4px' }}>
                    <i>{chunk.exampleEn}</i>
                    {chunk.exampleZh ? (
                      <span className="text-light"> {chunk.exampleZh}</span>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-light" style={{ fontSize: 13 }}>
                    暂无例句
                  </p>
                )}
              </>
            )}
            {chunk.anchorWordId ? (
              <p style={{ marginTop: 8 }}>
                锚词：{' '}
                <button
                  type="button"
                  className="linkish"
                  onClick={() =>
                    navigate(wordDetailPath(chunk.anchorWordId!), {
                      state: wordDetailDrillLinkState(detailNav),
                    })
                  }
                >
                  {chunk.anchorWordId}
                </button>
              </p>
            ) : null}
            <p className="text-light" style={{ fontSize: 12, marginTop: 8 }}>
              {ladderProgressLabel(chunk.progress)}
              {' · '}
              {formatNextReview(chunk.progress.nextReview)}
            </p>
            <Button size="small" style={{ marginTop: 8 }} onClick={startEdit}>
              编辑
            </Button>
          </>
        )}
      </div>

      <nav className="wd-bottom-bar" aria-label="语块操作">
        <button
          type="button"
          className="wd-bar-btn"
          disabled={!prevChunk}
          onClick={goPrev}
          title="上一个"
          aria-label="上一个"
        >
          <LeftOutlined />
        </button>
        <button
          type="button"
          className="wd-bar-btn"
          disabled={!nextChunk}
          onClick={goNext}
          title="下一个"
          aria-label="下一个"
        >
          <RightOutlined />
        </button>
        <button
          type="button"
          className={`wd-bar-btn${chunk.progress.starred ? ' is-starred' : ''}`}
          onClick={() => void toggleStarred()}
          title={chunk.progress.starred ? '取消星标' : '加星标'}
          aria-label={chunk.progress.starred ? '取消星标' : '加星标'}
        >
          {chunk.progress.starred ? <StarFilled /> : <StarOutlined />}
        </button>
        <Popconfirm
          title="删除这条语块？"
          onConfirm={() => void handleDelete()}
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
        >
          <button type="button" className="wd-bar-btn danger" title="删除" aria-label="删除">
            <CloseOutlined />
          </button>
        </Popconfirm>
        <button
          type="button"
          className="wd-bar-primary"
          onClick={() => navigate(`/practice?deck=chunk&scope=mixed&focus=${chunk.id}`)}
          title="复习本条"
          aria-label="复习本条"
        >
          <PlayCircleOutlined />
        </button>
      </nav>
    </div>
  );
}
