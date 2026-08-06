import { useMemo } from 'react';
import { Button, App } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { useFramesStore, useFramesWithProgress } from '@/store/useFrames';
import {
  formatNextReview,
  ladderProgressLabel,
  getWordStage,
  wordStageClass,
  wordStageLabel,
} from '@/utils/scheduler';

export default function FrameDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { modal } = App.useApp();
  const items = useFramesWithProgress();
  const updateProgress = useFramesStore((s) => s.updateProgress);
  const removeFrame = useFramesStore((s) => s.removeFrame);
  const frame = useMemo(() => items.find((f) => f.id === id), [items, id]);

  if (!frame) {
    return (
      <div className="page-pad">
        <div className="app-card empty">
          <p>找不到这条模板</p>
          <Button type="primary" onClick={() => navigate('/chunks')}>
            返回搭配
          </Button>
        </div>
      </div>
    );
  }

  const stage = getWordStage({
    ...frame.progress,
    crossedOut: !!frame.progress.crossedOut,
  });

  return (
    <div className="page-pad">
      <nav className="wd-navbar">
        <button
          type="button"
          className="wd-navbar-back"
          onClick={() => navigate('/chunks')}
        >
          ←
        </button>
        <h1 className="wd-navbar-title">{frame.title}</h1>
        <span className={`wd-navbar-stage ${wordStageClass(stage)}`}>
          {wordStageLabel(stage)}
        </span>
      </nav>

      <div className="app-card" style={{ marginTop: 12 }}>
        <p style={{ margin: '0 0 8px' }}>{frame.glossZh}</p>
        <p style={{ fontFamily: 'Georgia, serif', fontSize: 17, margin: '0 0 12px' }}>
          {frame.skeleton}
        </p>
        {frame.slots?.length ? (
          <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13 }}>
            {frame.slots.map((s) => (
              <li key={s.key}>
                <code>[{s.key}]</code> {s.hintZh}
              </li>
            ))}
          </ul>
        ) : null}
        {frame.exampleFilled ? (
          <details>
            <summary className="text-light" style={{ cursor: 'pointer' }}>
              参考范文（不强制背生词）
            </summary>
            <p style={{ marginTop: 8 }}>{frame.exampleFilled}</p>
          </details>
        ) : null}
        <p className="text-light" style={{ fontSize: 12, marginTop: 12 }}>
          {ladderProgressLabel(frame.progress)}
          {' · '}
          {formatNextReview(frame.progress.nextReview)}
        </p>
      </div>

      <nav className="wd-bottom-bar" aria-label="模板操作">
        <Button
          onClick={() =>
            void updateProgress({
              ...frame.progress,
              starred: !frame.progress.starred,
            })
          }
        >
          {frame.progress.starred ? '取消星标' : '星标'}
        </Button>
        <Button
          danger
          onClick={() =>
            modal.confirm({
              title: '从模板本删除？',
              onOk: async () => {
                await removeFrame(frame.id);
                navigate('/chunks');
              },
            })
          }
        >
          删除
        </Button>
        <Button
          type="primary"
          onClick={() => navigate(`/practice?deck=frame&scope=mixed&focus=${frame.id}`)}
        >
          复习本条
        </Button>
      </nav>
    </div>
  );
}
