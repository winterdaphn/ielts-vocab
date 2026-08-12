import { Link } from 'react-router-dom';
import { LeftOutlined } from '@ant-design/icons';

interface Props {
  idx: number;
  total: number;
  progressPct?: number;
  /** 跳转前同步保存本机进度；导航由 Link 负责，避免部分移动端 onClick+navigate 失效 */
  onBeforeExit?: () => void;
}

export default function PracticeHeader({
  idx,
  total,
  progressPct,
  onBeforeExit,
}: Props) {
  const pct =
    progressPct ?? (total ? Math.round((idx / total) * 100) : 0);

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
      <div className="progress-bar" aria-hidden>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-text">{total ? `${idx + 1} / ${total}` : '…'}</div>
    </header>
  );
}
