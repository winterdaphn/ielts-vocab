import { useMemo } from 'react';
import { Button, App, Popconfirm } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  CloseOutlined,
  StarOutlined,
  StarFilled,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useFramesStore, useFramesWithProgress } from '@/store/useFrames';
import {
  formatNextReview,
  ladderProgressLabel,
  getWordStage,
  wordStageClass,
  wordStageLabel,
} from '@/utils/scheduler';
import {
  type WordDetailNavState,
  wordDetailBrowseState,
  resolveWordDetailBack,
} from '@/utils/wordDetailNav';

export default function FrameDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const detailNav = (location.state ?? null) as WordDetailNavState | null;
  const { message } = App.useApp();
  const items = useFramesWithProgress();
  const updateProgress = useFramesStore((s) => s.updateProgress);
  const removeFrame = useFramesStore((s) => s.removeFrame);

  const sorted = useMemo(
    () =>
      [...items]
        .filter((f) => !f.progress.crossedOut)
        .sort((a, b) => a.progress.nextReview - b.progress.nextReview),
    [items]
  );
  const idx = useMemo(() => sorted.findIndex((f) => f.id === id), [sorted, id]);
  const frame = idx >= 0 ? sorted[idx] : items.find((f) => f.id === id);
  const prevFrame = idx > 0 ? sorted[idx - 1] : null;
  const nextFrame = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  function handleBack() {
    const historyIdx = (window.history.state as { idx?: number } | null)?.idx;
    const target = resolveWordDetailBack(detailNav, historyIdx, '/chunks');
    if (target.type === 'back') navigate(-1);
    else navigate(target.path);
  }

  if (!frame) {
    return (
      <div className="page-pad">
        <div className="app-card empty">
          <p>找不到这条模板</p>
          <Button type="primary" onClick={handleBack}>
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

  async function toggleStarred() {
    await updateProgress({
      ...frame!.progress,
      starred: !frame!.progress.starred,
    });
    message.success(frame!.progress.starred ? '已取消星标' : '已加星标');
  }

  async function handleDelete() {
    const goId = nextFrame?.id || prevFrame?.id;
    await removeFrame(frame!.id);
    message.success('已删除');
    if (goId) {
      navigate(`/frames/${goId}`, {
        replace: true,
        state: wordDetailBrowseState(detailNav),
      });
    } else navigate('/chunks', { replace: true });
  }

  function goPrev() {
    if (prevFrame) {
      navigate(`/frames/${prevFrame.id}`, {
        replace: true,
        state: wordDetailBrowseState(detailNav),
      });
    }
  }

  function goNext() {
    if (nextFrame) {
      navigate(`/frames/${nextFrame.id}`, {
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
          {frame.progress.starred ? <span className="wd-star-mark" aria-hidden>★ </span> : null}
          {frame.title}
        </h1>
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
        <button
          type="button"
          className="wd-bar-btn"
          disabled={!prevFrame}
          onClick={goPrev}
          title="上一个"
          aria-label="上一个"
        >
          <LeftOutlined />
        </button>
        <button
          type="button"
          className="wd-bar-btn"
          disabled={!nextFrame}
          onClick={goNext}
          title="下一个"
          aria-label="下一个"
        >
          <RightOutlined />
        </button>
        <button
          type="button"
          className={`wd-bar-btn${frame.progress.starred ? ' is-starred' : ''}`}
          onClick={() => void toggleStarred()}
          title={frame.progress.starred ? '取消星标' : '加星标'}
          aria-label={frame.progress.starred ? '取消星标' : '加星标'}
        >
          {frame.progress.starred ? <StarFilled /> : <StarOutlined />}
        </button>
        <Popconfirm
          title="从模板本删除？"
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
          onClick={() => navigate(`/practice?deck=frame&scope=mixed&focus=${frame.id}`)}
          title="复习本条"
          aria-label="复习本条"
        >
          <PlayCircleOutlined />
        </button>
      </nav>
    </div>
  );
}
