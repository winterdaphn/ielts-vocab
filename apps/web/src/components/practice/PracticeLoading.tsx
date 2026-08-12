import { Button, Spin } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PracticeHeader from './PracticeHeader';
import type { Mode } from '@/utils/practiceSelect';

interface Props {
  idx: number;
  total: number;
  mode: Mode;
  error?: string;
  onBeforeExit?: () => void;
  onRetry?: () => void;
}

export default function PracticeLoading({
  idx,
  total,
  mode,
  error,
  onBeforeExit,
  onRetry,
}: Props) {
  const modeText =
    mode === 'translate' ? '句子翻译' : mode === 'choice' ? '选词填空' : '输入填空';

  return (
    <div>
      <PracticeHeader idx={idx} total={total} onBeforeExit={onBeforeExit} />
      <div className="app-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        {error ? (
          <>
            <p style={{ color: 'var(--error)', fontSize: 14, marginBottom: 8 }}>{error}</p>
            <p className="mt-2" style={{ color: 'var(--text-mute)', fontSize: 12 }}>
              {modeText}
              {total ? ` · ${idx + 1} / ${total}` : ''}
            </p>
            {onRetry && (
              <Button
                type="primary"
                className="mt-3"
                icon={<ReloadOutlined />}
                onClick={onRetry}
              >
                重试出题
              </Button>
            )}
          </>
        ) : (
          <>
            <Spin size="large" />
            <p className="mt-3" style={{ color: 'var(--text-light)', fontSize: 14 }}>
              AI 正在出题…
            </p>
            <p className="mt-2" style={{ color: 'var(--text-mute)', fontSize: 12 }}>
              先准备前几题，其余答题时后台生成
            </p>
            <p className="mt-2" style={{ color: 'var(--text-mute)', fontSize: 12 }}>
              {modeText}
              {total ? ` · ${idx + 1} / ${total}` : ''}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
