import { Button } from 'antd';
import { SESSION_SIZE } from '@/utils/practiceSelect';

interface Props {
  correct: number;
  total: number;
  remaining: number;
  onContinue: () => void;
  onHome: () => void;
}

export default function PracticeDone({
  correct,
  total,
  remaining,
  onContinue,
  onHome,
}: Props) {
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  const nextBatch = Math.min(SESSION_SIZE, remaining);

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
    </div>
  );
}
