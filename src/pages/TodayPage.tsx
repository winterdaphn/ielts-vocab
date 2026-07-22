import { useMemo, useState } from 'react';
import { Button, App } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useUserWords } from '@/store/useWords';
import { isDue, isNew, isMastered } from '@/utils/scheduler';
import { useAuth } from '@/store/useAuth';
import { getLS } from '@/utils/date';
import {
  clearPracticeSession,
  getSavedPracticeSummary,
  readSavedPracticeSession,
} from '@/utils/practiceSession';

export default function TodayPage() {
  const { message, modal } = App.useApp();
  const words = useUserWords();
  const username = useAuth((s) => s.username);
  const navigate = useNavigate();
  const [savedTick, setSavedTick] = useState(0);

  const saved = useMemo(() => getSavedPracticeSummary(), [savedTick, words.length]);

  const newCount = useMemo(
    () => words.filter((w) => !w.crossedOut && isNew(w)).length,
    [words]
  );
  const dueCount = useMemo(
    () => words.filter((w) => !w.crossedOut && !isNew(w) && isDue(w)).length,
    [words]
  );
  const learnedCount = useMemo(
    () => words.filter((w) => !w.crossedOut && !isNew(w) && !isDue(w)).length,
    [words]
  );

  const learningCount = useMemo(
    () => words.filter((w) => !w.crossedOut && !isMastered(w)).length,
    [words]
  );
  const masteredCount = useMemo(
    () => words.filter(isMastered).length,
    [words]
  );
  const crossedCount = useMemo(
    () => words.filter((w) => w.crossedOut).length,
    [words]
  );

  const total = words.length;
  const taskCount = newCount + dueCount;
  const hasTasks = taskCount > 0;
  const sessionCount = Math.min(50, taskCount);
  const streak = parseInt(getLS('streak') || '0', 10);
  const todayDone = getLS('done-' + new Date().toDateString()) === '1';

  function startMode(mode: 'cloze' | 'choice' | 'translate') {
    if (readSavedPracticeSession()) {
      modal.confirm({
        title: '开始新练习？',
        content: '开始新练习会覆盖未完成的进度，确定吗？',
        okText: '确定',
        cancelText: '取消',
        onOk: () => {
          clearPracticeSession();
          setSavedTick((n) => n + 1);
          navigate(`/practice?mode=${mode}`);
        },
      });
      return;
    }
    navigate(`/practice?mode=${mode}`);
  }

  function resumePractice() {
    navigate('/practice?resume=1');
  }

  function discardPractice() {
    modal.confirm({
      title: '放弃进度？',
      content: '确定放弃上次未完成的练习进度？',
      okText: '放弃',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        clearPracticeSession();
        setSavedTick((n) => n + 1);
        message.success('已清除进度');
      },
    });
  }

  return (
    <div>
      <div className="app-header">
        <h1>IELTS 词汇训练</h1>
        <p>
          {new Date().toLocaleDateString('zh-CN', {
            year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
          })}
          {' · 👤 '}{username}
        </p>
      </div>

      {saved && (
        <div className="app-card resume-card">
          <h3 style={{ fontSize: 14, marginBottom: 6 }}>继续上次练习</h3>
          <p className="text-light" style={{ fontSize: 13, marginBottom: 12 }}>
            {saved.modeLabel} · 第 {saved.current}/{saved.total} 题
            {saved.when ? ` · 保存于 ${saved.when}` : ''}
          </p>
          <div className="flex-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button type="primary" onClick={resumePractice}>
              ▶ 继续学习
            </Button>
            <Button onClick={discardPractice}>放弃进度</Button>
          </div>
        </div>
      )}

      <div className="today-card">
        <h2>今日学习</h2>
        {streak > 0 && (
          <div className="streak-pill">🔥 连续学习 {streak} 天</div>
        )}
        <div className="today-stats">
          <div className="today-stat">
            <div className="num">{newCount}</div>
            <div className="label">新词</div>
          </div>
          <div className="today-stat">
            <div className="num">{dueCount}</div>
            <div className="label">待复习</div>
          </div>
          <div className="today-stat">
            <div className="num">{learnedCount}</div>
            <div className="label">已学过</div>
          </div>
        </div>
        <div className="today-actions">
          <Button
            size="large"
            block
            disabled={!hasTasks}
            onClick={() => startMode('cloze')}
          >
            输入填空 · {todayDone ? '再练' : '开始'} ({sessionCount}
            {taskCount > 50 ? `/${taskCount}` : ''})
          </Button>
          <Button
            size="large"
            block
            disabled={!hasTasks}
            onClick={() => startMode('choice')}
          >
            选词填空 · {todayDone ? '再练' : '开始'} ({sessionCount}
            {taskCount > 50 ? `/${taskCount}` : ''})
          </Button>
          <Button
            size="large"
            block
            disabled={!hasTasks}
            onClick={() => startMode('translate')}
          >
            句子翻译 · {todayDone ? '再练' : '开始'} ({sessionCount}
            {taskCount > 50 ? `/${taskCount}` : ''})
          </Button>
        </div>
      </div>

      <div className="app-card">
        <h3>快速统计</h3>
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
      </div>

      {!hasTasks && (
        <div className="app-card empty">
          <div className="empty-icon">🎉</div>
          <h3>今日无任务</h3>
          <p>所有词都掌握了，去「添加」加几个新词吧</p>
        </div>
      )}
    </div>
  );
}
