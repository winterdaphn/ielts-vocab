import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LeftOutlined } from '@ant-design/icons';

interface Props {
  idx: number;
  total: number;
  progressPct?: number;
  /** 可跳转的最远题号（0-based，仅已作答题） */
  maxJumpIdx?: number;
  /** 与题目顺序对应的单词，用于拖动预览 */
  wordLabels?: string[];
  /** 跳转前同步保存本机进度；导航由 Link 负责，避免部分移动端 onClick+navigate 失效 */
  onBeforeExit?: () => void;
  /** 拖动/点击进度条跳转到指定题（0-based）；仅在松手时触发 */
  onJumpTo?: (targetIdx: number) => void;
  jumpDisabled?: boolean;
}

function idxFromClientX(
  clientX: number,
  track: HTMLElement,
  total: number,
  maxIdx: number
): number {
  if (total <= 1) return 0;
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const raw = Math.min(total - 1, Math.floor(ratio * total));
  return Math.min(maxIdx, raw);
}

function thumbLeftPct(index: number, total: number): number {
  if (!total) return 0;
  if (total === 1) return 50;
  return ((index + 0.5) / total) * 100;
}

function fillWidthPct(index: number, total: number): number {
  if (!total) return 0;
  return Math.round(((index + 1) / total) * 100);
}

function jumpTipText(previewIndex: number, wordLabels?: string[]): string {
  const word = wordLabels?.[previewIndex]?.trim();
  return word ? `第 ${previewIndex + 1} 题 · ${word}` : `第 ${previewIndex + 1} 题`;
}

export default function PracticeHeader({
  idx,
  total,
  progressPct,
  maxJumpIdx,
  wordLabels,
  onBeforeExit,
  onJumpTo,
  jumpDisabled = false,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const previewIdxRef = useRef(idx);
  const [dragging, setDragging] = useState(false);

  const jumpMax = Math.min(total > 0 ? total - 1 : 0, maxJumpIdx ?? total - 1);
  const interactive = total > 1 && jumpMax >= 0 && !!onJumpTo && !jumpDisabled;
  const pct =
    progressPct ??
    (total ? Math.round(((idx + 1) / total) * 100) : 0);
  const thumbPct = thumbLeftPct(idx, total);
  const unreachedLeftPct =
    total && jumpMax + 1 < total ? ((jumpMax + 1) / total) * 100 : 100;

  const applyPreviewVisual = useCallback(
    (previewIndex: number) => {
      previewIdxRef.current = previewIndex;
      const left = `${thumbLeftPct(previewIndex, total)}%`;
      const width = `${fillWidthPct(previewIndex, total)}%`;
      if (fillRef.current) fillRef.current.style.width = width;
      if (thumbRef.current) thumbRef.current.style.left = left;
      if (tipRef.current) {
        tipRef.current.style.left = left;
        tipRef.current.textContent = jumpTipText(previewIndex, wordLabels);
      }
      if (textRef.current && total) {
        textRef.current.textContent = `${previewIndex + 1} / ${total}`;
      }
    },
    [total, wordLabels]
  );

  const clearPreviewVisual = useCallback(() => {
    if (fillRef.current) fillRef.current.style.width = '';
    if (thumbRef.current) thumbRef.current.style.left = '';
    if (tipRef.current) tipRef.current.style.left = '';
    if (textRef.current && total) {
      textRef.current.textContent = `${idx + 1} / ${total}`;
    }
  }, [idx, total]);

  const finishDrag = useCallback(
    (clientX: number) => {
      if (!draggingRef.current) return;
      const track = trackRef.current;
      const target =
        track && total
          ? idxFromClientX(clientX, track, total, jumpMax)
          : previewIdxRef.current;

      draggingRef.current = false;
      setDragging(false);
      clearPreviewVisual();

      if (onJumpTo && target !== idx) {
        onJumpTo(target);
      }
    },
    [clearPreviewVisual, idx, jumpMax, onJumpTo, total]
  );

  function onTrackPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) return;
    e.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    applyPreviewVisual(idxFromClientX(e.clientX, e.currentTarget, total, jumpMax));
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onTrackPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    applyPreviewVisual(idxFromClientX(e.clientX, e.currentTarget, total, jumpMax));
  }

  function onTrackPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    finishDrag(e.clientX);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  return (
    <header className="practice-header">
      <Link
        to="/today"
        replace
        className="back-btn"
        aria-label="返回"
        title="返回"
        onClick={() => onBeforeExit?.()}
      >
        <LeftOutlined />
      </Link>
      <div
        ref={trackRef}
        className={`progress-scrubber${interactive ? ' interactive' : ''}${
          dragging ? ' dragging' : ''
        }`}
        role={interactive ? 'slider' : undefined}
        aria-valuemin={interactive ? 1 : undefined}
        aria-valuemax={interactive ? jumpMax + 1 : undefined}
        aria-valuenow={interactive ? idx + 1 : undefined}
        aria-label={
          interactive
            ? `题目进度，可在已作答题间拖动切换，当前第 ${idx + 1} 题`
            : undefined
        }
        title={interactive ? '拖动松手后切换已作答题' : undefined}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerUp}
      >
        <div className="progress-scrubber-track" aria-hidden>
          {interactive && jumpMax + 1 < total ? (
            <div
              className="progress-scrubber-unreached"
              style={{ left: `${unreachedLeftPct}%` }}
              aria-hidden
            />
          ) : null}
          <div
            ref={fillRef}
            className="progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
        {interactive ? (
          <>
            <div
              ref={thumbRef}
              className="progress-thumb"
              style={{ left: `${thumbPct}%` }}
              aria-hidden
            />
            <div
              ref={tipRef}
              className="progress-scrub-tip"
              style={{ left: `${thumbPct}%`, display: dragging ? 'block' : 'none' }}
              aria-hidden
            >
              {jumpTipText(idx, wordLabels)}
            </div>
          </>
        ) : null}
      </div>
      <div ref={textRef} className="progress-text">
        {total ? `${idx + 1} / ${total}` : '…'}
      </div>
    </header>
  );
}
