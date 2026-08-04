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
  type StudyScope,
  type SentenceDifficulty,
} from '@/utils/practiceSession';
import { countByScope } from '@/utils/practiceSelect';
import { getLearningCurve } from '@/utils/learningLog';
import LearningCurve from '@/components/LearningCurve';

const SCOPES: { key: StudyScope; label: string; hint: string }[] = [
  { key: 'new', label: '学新词', hint: '只练从未复习过的词' },
  {
    key: 'review',
    label: '复习',
    hint: '按艾宾浩斯到期复习：5分钟 → 30分钟 → 12小时 → 1/2/4/7/15/30天',
  },
  { key: 'mixed', label: '混合', hint: '新词优先，再穿插到期复习' },
  { key: 'starred', label: '星标', hint: '只练你标过星的词，不受到期时间限制' },
];

const DIFFICULTIES: { key: SentenceDifficulty; label: string; hint: string }[] = [
  { key: 'easy', label: '简单', hint: '短句、单层结构，适合入门' },
  { key: 'medium', label: '中等', hint: '与当前默认接近的自然句' },
  { key: 'hard', label: '困难', hint: '长难句、从句嵌套，冲击写作' },
];

export default function TodayPage() {
  const { message, modal } = App.useApp();
  const words = useUserWords();
  const username = useAuth((s) => s.username);
  const navigate = useNavigate();
  const [savedTick, setSavedTick] = useState(0);
  const [scope, setScope] = useState<StudyScope>('mixed');
  const [difficulty, setDifficulty] = useState<SentenceDifficulty>('medium');

  const saved = useMemo(() => getSavedPracticeSummary(), [savedTick, words.length]);
  const curve = useMemo(() => getLearningCurve(14), [savedTick, words.length]);
  const scopeCounts = useMemo(() => countByScope(words), [words]);

  const newCount = scopeCounts.newCount;
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
  const starredCount = useMemo(
    () => words.filter((w) => !w.crossedOut && !!w.starred).length,
    [words]
  );

  const total = words.length;
  const taskCount =
    scope === 'new'
      ? scopeCounts.newCount
      : scope === 'review'
        ? scopeCounts.reviewCount
        : scope === 'starred'
          ? scopeCounts.starredCount
          : scopeCounts.mixedCount;
  const hasTasks = taskCount > 0;
  const sessionCount = Math.min(50, taskCount);
  const streak = parseInt(getLS('streak') || '0', 10);
  const todayDone = getLS('done-' + new Date().toDateString()) === '1';
  const activeScope = SCOPES.find((s) => s.key === scope)!;
  const activeDifficulty = DIFFICULTIES.find((d) => d.key === difficulty)!;

  function startMode(mode: 'cloze' | 'choice' | 'translate') {
    const go = () =>
      navigate(`/practice?mode=${mode}&scope=${scope}&difficulty=${difficulty}`);
    if (readSavedPracticeSession()) {
      modal.confirm({
        title: '开始新练习？',
        content: '开始新练习会覆盖未完成的进度，确定吗？',
        okText: '确定',
        cancelText: '取消',
        onOk: () => {
          clearPracticeSession();
          setSavedTick((n) => n + 1);
          go();
        },
      });
      return;
    }
    go();
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
            {saved.modeLabel}
            {saved.scopeLabel ? ` · ${saved.scopeLabel}` : ''}
            {saved.difficultyLabel ? ` · ${saved.difficultyLabel}` : ''}
            {' · '}第 {saved.current}/{saved.total} 题
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
        <p className="text-light" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
          复习按艾宾浩斯阶梯出题，仅包含已到期的词
        </p>

        <div className="scope-tabs" role="tablist" aria-label="学习范围">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={scope === s.key}
              className={`scope-tab ${scope === s.key ? 'active' : ''}`}
              onClick={() => setScope(s.key)}
            >
              {s.label}
              <span className="scope-count">
                {s.key === 'new'
                  ? scopeCounts.newCount
                  : s.key === 'review'
                    ? scopeCounts.reviewCount
                    : s.key === 'starred'
                      ? scopeCounts.starredCount
                      : scopeCounts.mixedCount}
              </span>
            </button>
          ))}
        </div>
        <p className="scope-hint">{activeScope.hint}</p>

        <div className="scope-tabs" role="tablist" aria-label="造句难度">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={difficulty === d.key}
              className={`scope-tab ${difficulty === d.key ? 'active' : ''}`}
              onClick={() => setDifficulty(d.key)}
            >
              {d.label}
            </button>
          ))}
        </div>
        <p className="scope-hint">{activeDifficulty.hint}</p>

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
        <LearningCurve data={curve} />
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
            <div className="num">{starredCount}</div>
            <div className="label">星标</div>
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
          <h3>
            {scope === 'new'
              ? '没有新词'
              : scope === 'review'
                ? '暂无复习任务'
                : scope === 'starred'
                  ? '还没有星标词'
                  : '今日无任务'}
          </h3>
          <p>
            {scope === 'new'
              ? '去「添加」加几个新词，或切换到「复习」'
              : scope === 'review'
                ? '没有到期词，可以去学新词'
                : scope === 'starred'
                  ? '在词表或详情页点 ★ 标出重点词后再来练'
                  : '所有词都掌握了，去「添加」加几个新词吧'}
          </p>
        </div>
      )}
    </div>
  );
}
