import { Button } from 'antd';
import { RightOutlined, ReloadOutlined } from '@ant-design/icons';
import { usePracticeSession } from '@/hooks/usePracticeSession';
import { isClozeFamily } from '@/utils/practiceSelect';
import { modeLabel, scopeLabel, difficultyLabel } from '@/utils/practiceSession';
import { sentenceSourceLabel } from '@/api/llm';
import PracticeHeader from '@/components/practice/PracticeHeader';
import PracticeModeSelect from '@/components/practice/PracticeModeSelect';
import PracticeLoading from '@/components/practice/PracticeLoading';
import PracticeDone from '@/components/practice/PracticeDone';
import ClozePanel from '@/components/practice/ClozePanel';
import ChoicePanel from '@/components/practice/ChoicePanel';
import TranslatePanel from '@/components/practice/TranslatePanel';
import SpeakButton from '@/components/SpeakButton';
import PhoneticDisplay from '@/components/PhoneticDisplay';

export default function PracticePage() {
  const s = usePracticeSession();

  if (s.phase === 'selecting' && !s.hasModeParam) {
    return (
      <PracticeModeSelect
        onStart={(m) => s.startPractice(m, s.scope, s.difficulty)}
        onBack={() => s.navigate('/today')}
      />
    );
  }

  if (
    s.phase === 'loading' ||
    (s.phase === 'selecting' && s.hasModeParam) ||
    s.phase === 'waiting'
  ) {
    return (
      <PracticeLoading
        idx={s.idx}
        total={s.total}
        mode={s.mode}
        error={s.genError}
        onExit={s.exitPractice}
        onRetry={s.genError ? s.retryGenerate : undefined}
      />
    );
  }

  if (s.phase === 'done') {
    return (
      <PracticeDone
        correct={s.stats.correct}
        total={s.stats.total}
        remaining={s.remainingCount}
        onContinue={() => s.startPractice(s.mode, s.scope, s.difficulty)}
        onHome={s.exitPractice}
      />
    );
  }

  if (!s.current) {
    return (
      <div className="app-card empty">
        <h3>没有题目</h3>
        <Button type="primary" className="mt-3" onClick={s.exitPractice}>
          返回
        </Button>
      </div>
    );
  }

  const current = s.current;
  const judging = s.phase === 'judging';
  const answerWord =
    s.judgeResult?.expected || current.example.blank || current.word.word;
  const isNewCard = !!current.wasNew;

  return (
    <div>
      <PracticeHeader
        idx={s.idx}
        total={s.total}
        progressPct={s.progressPct}
        onExit={s.exitPractice}
      />

      <div className="practice-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <div
            className={`mode-tag ${s.mode === 'translate' ? 'translate-mode' : ''}`}
            style={{ marginBottom: 0 }}
          >
            {modeLabel(s.mode)}
          </div>
          <span className={`tag ${isNewCard ? 'tag-new' : 'tag-due'}`}>
            {isNewCard ? '新词' : '复习'}
          </span>
          {s.scope !== 'mixed' && (
            <span className="tag tag-learning">{scopeLabel(s.scope)}</span>
          )}
          <span
            className={`tag ${
              s.difficulty === 'easy'
                ? 'tag-diff-easy'
                : s.difficulty === 'hard'
                  ? 'tag-diff-hard'
                  : 'tag-learning'
            }`}
          >
            {difficultyLabel(s.difficulty)}
          </span>
          <span
            className={`sentence-source-tag source-${current.source || 'unknown'}`}
            title="本题例句来源（调试）"
          >
            {sentenceSourceLabel(current.source)}
          </span>
        </div>

        {s.mode === 'translate' || s.showAnswer ? (
          <div style={{ marginBottom: 14 }}>
            <div
              className="word-display"
              style={{
                fontSize: s.showAnswer && isClozeFamily(s.mode) ? 22 : 28,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              {isClozeFamily(s.mode) && s.showAnswer ? (
                <>
                  答案是{' '}
                  <b style={{ color: 'var(--accent)' }}>{answerWord}</b>
                  <SpeakButton text={answerWord} title="复习读音" />
                </>
              ) : (
                <>
                  {current.word.word}
                  <SpeakButton text={current.word.word} title="发音" />
                </>
              )}
            </div>
            {(current.word.phoneticUs || current.word.phoneticUk || current.word.phonetic) && (
              <div style={{ color: 'var(--text-light)', fontSize: 13, marginBottom: 4 }}>
                <PhoneticDisplay word={current.word} withSpeak />
                {current.word.partOfSpeech ? (
                  <span> · {current.word.partOfSpeech}</span>
                ) : null}
              </div>
            )}
          </div>
        ) : (
          <div className="text-light" style={{ fontSize: 13, marginBottom: 14 }}>
            🔍 词不告诉你，看语境猜
            {isNewCard ? ' · 新词' : ' · 复习'}
          </div>
        )}

        {s.mode === 'cloze' ? (
          <ClozePanel
            current={current}
            showAnswer={s.showAnswer}
            hintShown={s.hintShown}
            userText={s.userText}
            judgeResult={s.judgeResult}
            mnemonicTip={s.mnemonicTip}
            mnemonicLoading={s.mnemonicLoading}
            synonymsTip={s.synonymsTip}
            similarsTip={s.similarsTip}
            derivativesTip={s.derivativesTip}
            relatedLoading={s.relatedLoading}
            structureTip={s.structureTip}
            structureLoading={s.structureLoading}
            structureAvailable={s.structureAvailable}
            judging={judging}
            onUserTextChange={s.setUserText}
            onHint={() => s.setHintShown(true)}
            onSubmit={s.submitClozeInput}
            onRequestStructure={s.requestStructureTip}
          />
        ) : s.mode === 'choice' ? (
          <ChoicePanel
            current={current}
            showAnswer={s.showAnswer}
            hintShown={s.hintShown}
            picked={s.picked}
            synonymsTip={s.synonymsTip}
            similarsTip={s.similarsTip}
            derivativesTip={s.derivativesTip}
            relatedLoading={s.relatedLoading}
            structureTip={s.structureTip}
            structureLoading={s.structureLoading}
            structureAvailable={s.structureAvailable}
            onPick={s.pickAnswer}
            onHint={() => s.setHintShown(true)}
            onRequestStructure={s.requestStructureTip}
          />
        ) : (
          <TranslatePanel
            current={current}
            userText={s.userText}
            judgeResult={s.judgeResult}
            judging={judging}
            hintLevel={s.translateHintLevel}
            hints={s.translateHints}
            hintLoading={s.translateHintLoading}
            onUserTextChange={s.setUserText}
            onHint={s.requestTranslateHint}
            onSubmit={s.submitTranslate}
          />
        )}

        {s.canGoNext && (
          <Button
            type="primary"
            block
            size="large"
            onClick={s.next}
            style={{ marginTop: 16 }}
            icon={<RightOutlined />}
          >
            {s.idx + 1 >= s.total ? '完成' : '下一题 →'}
          </Button>
        )}
      </div>

      <div
        className="flex-row"
        style={{ justifyContent: 'center', gap: 8, marginTop: 10 }}
      >
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          onClick={s.regenerateCurrent}
          disabled={judging}
          title="换一道题"
        >
          换一句
        </Button>
      </div>

      <div
        className="app-card text-light"
        style={{ fontSize: 12, textAlign: 'center', padding: 12, marginTop: 14 }}
      >
        本轮已答对 <b style={{ color: 'var(--accent)' }}>{s.stats.correct}</b> · 共{' '}
        {s.stats.total} 题
      </div>
    </div>
  );
}
