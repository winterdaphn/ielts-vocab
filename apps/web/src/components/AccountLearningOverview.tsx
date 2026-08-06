import { useMemo } from 'react';
import { useUserWords } from '@/store/useWords';
import { isMastered } from '@/utils/scheduler';
import { getLearningCurve } from '@/utils/learningLog';
import LearningCurve from '@/components/LearningCurve';

/** 学习曲线 + 词库统计（设置 · 账户） */
export default function AccountLearningOverview() {
  const words = useUserWords();
  const curve = useMemo(() => getLearningCurve(14), [words.length]);

  const learningCount = useMemo(
    () => words.filter((w) => !w.crossedOut && !isMastered(w)).length,
    [words]
  );
  const masteredCount = useMemo(() => words.filter(isMastered).length, [words]);
  const crossedCount = useMemo(
    () => words.filter((w) => w.crossedOut).length,
    [words]
  );
  const total = words.length;

  return (
    <>
      <div style={{ marginTop: 16 }}>
        <LearningCurve data={curve} />
      </div>
      <h3 style={{ fontSize: 14, marginTop: 20, marginBottom: 10 }}>快速统计</h3>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="num">{learningCount}</div>
          <div className="label">学习中</div>
        </div>
        <div className="stat-card">
          <div className="num">{masteredCount}</div>
          <div className="label">已掌握</div>
        </div>
        <div className="stat-card">
          <div className="num">{crossedCount}</div>
          <div className="label">已划掉</div>
        </div>
        <div className="stat-card">
          <div className="num">{total}</div>
          <div className="label">总词数</div>
        </div>
      </div>
    </>
  );
}
