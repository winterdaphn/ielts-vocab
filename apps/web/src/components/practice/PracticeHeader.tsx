interface Props {
  idx: number;
  total: number;
  progressPct?: number;
  onExit: () => void;
}

export default function PracticeHeader({ idx, total, progressPct, onExit }: Props) {
  const pct =
    progressPct ?? (total ? Math.round((idx / total) * 100) : 0);

  return (
    <div className="practice-header">
      <button type="button" className="back-btn" onClick={onExit} title="退出">
        ←
      </button>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-text">{total ? `${idx + 1} / ${total}` : '…'}</div>
    </div>
  );
}
