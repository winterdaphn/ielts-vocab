import { useMemo, useState } from 'react';
import { Button, Input, App } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
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
import { useWordDetailEntryNav } from '@/utils/wordDetailNav';

export default function ChunkDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const entryNav = useWordDetailEntryNav();
  const { message, modal } = App.useApp();
  const items = useChunksWithProgress();
  const updateChunk = useChunksStore((s) => s.updateChunk);
  const updateProgress = useChunksStore((s) => s.updateProgress);
  const removeChunk = useChunksStore((s) => s.removeChunk);
  const chunk = useMemo(() => items.find((c) => c.id === id), [items, id]);
  const [editing, setEditing] = useState(false);
  const [gloss, setGloss] = useState('');
  const [explanation, setExplanation] = useState('');

  if (!chunk) {
    return (
      <div className="page-pad">
        <div className="app-card empty">
          <p>找不到这条语块</p>
          <Button type="primary" onClick={() => navigate('/chunks')}>
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

  return (
    <div className="page-pad wd-detail-like">
      <nav className="wd-navbar">
        <button type="button" className="wd-navbar-back" onClick={() => navigate('/chunks')}>
          ←
        </button>
        <h1 className="wd-navbar-title">{chunk.phrase}</h1>
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
                    navigate(wordDetailPath(chunk.anchorWordId!), { state: entryNav })
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
        <Button
          onClick={() =>
            void updateProgress({
              ...chunk.progress,
              starred: !chunk.progress.starred,
            })
          }
        >
          {chunk.progress.starred ? '取消星标' : '星标'}
        </Button>
        <Button
          danger
          onClick={() =>
            modal.confirm({
              title: '删除这条语块？',
              onOk: async () => {
                await removeChunk(chunk.id);
                navigate('/chunks');
              },
            })
          }
        >
          删除
        </Button>
        <Button
          type="primary"
          onClick={() => navigate(`/practice?deck=chunk&scope=mixed&focus=${chunk.id}`)}
        >
          复习本条
        </Button>
      </nav>
    </div>
  );
}
