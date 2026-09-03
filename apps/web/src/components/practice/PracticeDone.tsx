import { Button } from 'antd';
import { SESSION_SIZE } from '@/utils/practiceSelect';
import type { SessionReviewItem } from '@/hooks/practice/types';
import type { PracticeMode } from '@/utils/practiceSession';
import { modeLabel } from '@/utils/practiceSession';

interface Props {
  correct: number;
  total: number;
  /** 本轮词数（用于再次测试文案） */
  sessionTotal: number;
  remaining: number;
  mode: PracticeMode;
  review?: SessionReviewItem[];
  onContinue: () => void;
  onRetestSame: () => void;
  onRetestAsCloze?: () => void;
  onHome: () => void;
}

export default function PracticeDone({
  correct,
  total,
  sessionTotal,
  remaining,
  mode,
  review = [],
  onContinue,
  onRetestSame,
  onRetestAsCloze,
  onHome,
}: Props) {
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  const nextBatch = Math.min(SESSION_SIZE, remaining);
  const batchLabel = sessionTotal > 0 ? sessionTotal : SESSION_SIZE;
  const answeredReview = review.filter((item) => item.correct !== null);

  return (
    <div>
      <div className="app-header">
        <h1>练习完成</h1>
        <p>
          正确率 {accuracy}% · {correct}/{total}
        </p>
      </div>
      <div className="today-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
        <h2 style={{ fontSize: 18, opacity: 1, marginBottom: 8 }}>本轮练习完成</h2>
        {remaining > 0 ? (
          <p style={{ fontSize: 13, opacity: 0.85, marginBottom: 16 }}>
            还剩 {remaining} 个词可练，下一组最多 {nextBatch} 个
          </p>
        ) : (
          <p style={{ fontSize: 13, opacity: 0.85, marginBottom: 16 }}>
            今日任务已清完
          </p>
        )}
        <Button
          size="large"
          block
          onClick={onContinue}
          style={{
            background: 'white',
            color: 'var(--accent)',
            borderColor: 'white',
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          {remaining > 0 ? `继续下一组 (${nextBatch})` : '再练一组'}
        </Button>
        {sessionTotal > 0 ? (
          <Button
            size="large"
            block
            onClick={onRetestSame}
            style={{
              background: 'rgba(255,255,255,0.92)',
              color: 'var(--accent)',
              borderColor: 'rgba(255,255,255,0.92)',
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            再次测试 · {modeLabel(mode)}（{batchLabel} 词·打乱）
          </Button>
        ) : null}
        {mode === 'choice' && onRetestAsCloze && sessionTotal > 0 ? (
          <Button
            size="large"
            block
            onClick={onRetestAsCloze}
            style={{
              background: 'rgba(255,255,255,0.85)',
              color: 'var(--accent)',
              borderColor: 'rgba(255,255,255,0.85)',
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            输入填空 · 同一批 {batchLabel} 词
          </Button>
        ) : null}
        <Button
          size="large"
          block
          onClick={onHome}
          style={{
            background: 'rgba(255,255,255,0.18)',
            color: 'white',
            borderColor: 'rgba(255,255,255,0.4)',
          }}
        >
          返回首页
        </Button>
      </div>

      {answeredReview.length > 0 ? (
        <div className="app-card practice-review-card">
          <h3 className="practice-review-title">本轮复习</h3>
          <ul className="practice-review-list">
            {answeredReview.map((item, i) => (
              <li
                key={`${item.word}-${i}`}
                className={`practice-review-item${
                  item.correct ? ' is-correct' : ' is-wrong'
                }`}
                title={item.translation || undefined}
              >
                {item.word}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
