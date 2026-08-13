import { Button } from 'antd';
import {
  HeartFilled,
  HeartOutlined,
  LeftOutlined,
  RightOutlined,
  ReloadOutlined,
  StarOutlined,
  StarFilled,
} from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { usePracticeSession } from '@/hooks/usePracticeSession';
import { isClozeFamily } from '@/utils/practiceSelect';
import { modeLabel, scopeLabel, difficultyLabel } from '@/utils/practiceSession';
import PracticeHeader from '@/components/practice/PracticeHeader';
import PracticeModeSelect from '@/components/practice/PracticeModeSelect';
import PracticeLoading from '@/components/practice/PracticeLoading';
import PracticeDone from '@/components/practice/PracticeDone';
import ClozePanel from '@/components/practice/ClozePanel';
import ChoicePanel from '@/components/practice/ChoicePanel';
import TranslatePanel from '@/components/practice/TranslatePanel';
import SpeakButton from '@/components/SpeakButton';
import PhoneticDisplay from '@/components/PhoneticDisplay';
import SentenceSpeakButton from '@/components/practice/SentenceSpeakBar';
import DeckPracticePage from '@/pages/DeckPracticePage';

export default function PracticePage() {
  const [params] = useSearchParams();
  const deck = params.get('deck');
  if (deck === 'chunk' || deck === 'frame') {
    return <DeckPracticePage />;
  }
  return <WordPracticePage />;
}

function WordPracticePage() {
  const s = usePracticeSession();

  if (s.phase === 'selecting' && !s.hasModeParam) {
    return (
      <PracticeModeSelect
        onStart={(m) => s.startPracticeFromModeSelect(m)}
        onStartClozeBatch={() => s.startPracticeFromModeSelect('cloze')}
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
        onBeforeExit={s.prepareExitPractice}
        onRetry={s.genError ? s.retryGenerate : undefined}
      />
    );
  }

  if (s.phase === 'done') {
    return (
      <PracticeDone
        correct={s.stats.correct}
        total={s.stats.total}
        sessionTotal={s.total}
        remaining={s.remainingCount}
        mode={s.mode}
        onContinue={() => s.startPractice(s.mode, s.scope, s.difficulty)}
        onRetestSame={() => s.retestSessionWords()}
        onRetestAsCloze={
          s.mode === 'choice'
            ? () => s.retestSessionWords('cloze')
            : undefined
        }
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
  const busy = judging || s.regenerating;
  const answerWord =
    s.judgeResult?.expected || current.example.blank || current.word.word;
  const isNewCard = !!current.wasNew;
  const showWordHead = s.mode === 'translate' || s.showAnswer;
  const showPhoneticRow = isClozeFamily(s.mode) && s.showAnswer;
  const hasPhonetic =
    !!(current.word.phoneticUs || current.word.phoneticUk || current.word.phonetic);

  return (
    <div>
      <PracticeHeader
        idx={s.idx}
        total={s.total}
        progressPct={s.progressPct}
        onBeforeExit={s.prepareExitPractice}
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
        </div>

        {showWordHead ? (
          <div style={{ marginBottom: showPhoneticRow ? 8 : 14 }}>
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
                  <button
                    type="button"
                    className={`practice-star-btn${current.word.starred ? ' active' : ''}`}
                    title={current.word.starred ? '取消星标' : '加星标'}
                    onClick={s.toggleStarred}
                  >
                    {current.word.starred ? <StarFilled /> : <StarOutlined />}
                  </button>
                </>
              ) : (
                <>
                  {current.word.word}
                  <SpeakButton text={current.word.word} title="发音" />
                  <button
                    type="button"
                    className={`practice-star-btn${current.word.starred ? ' active' : ''}`}
                    title={current.word.starred ? '取消星标' : '加星标'}
                    onClick={s.toggleStarred}
                  >
                    {current.word.starred ? <StarFilled /> : <StarOutlined />}
                  </button>
                </>
              )}
            </div>
            {s.mode === 'translate' && hasPhonetic && (
              <div style={{ color: 'var(--text-light)', fontSize: 13, marginBottom: 4 }}>
                <PhoneticDisplay word={current.word} withSpeak />
                {current.word.partOfSpeech ? (
                  <span> · {current.word.partOfSpeech}</span>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {showPhoneticRow ? (
          <div className="practice-phonetic-row">
            <div className="practice-phonetic-row__main">
              {hasPhonetic ? (
                <PhoneticDisplay word={current.word} withSpeak />
              ) : (
                <span className="text-light" style={{ fontSize: 13 }}>
                  {current.word.partOfSpeech || ''}
                </span>
              )}
              {s.showAnswer && current.word.partOfSpeech && hasPhonetic ? (
                <span className="text-light" style={{ fontSize: 13 }}>
                  {' '}
                  · {current.word.partOfSpeech}
                </span>
              ) : null}
            </div>
            <SentenceSpeakButton text={current.example.en} />
          </div>
        ) : null}

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
            judging={busy}
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
            disabled={busy}
            onPick={s.pickAnswer}
            onHint={() => s.setHintShown(true)}
            onRequestStructure={s.requestStructureTip}
          />
        ) : (
          <TranslatePanel
            current={current}
            userText={s.userText}
            judgeResult={s.judgeResult}
            judging={busy}
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
            disabled={s.regenerating}
            style={{ marginTop: 16 }}
            icon={<RightOutlined />}
            title="Enter"
          >
            {s.idx + 1 >= s.total ? '完成' : '下一题 →'}
            <span className="practice-next-kbd">Enter</span>
          </Button>
        )}
        {s.canGoPrevious && (
          <Button
            block
            size="large"
            onClick={s.prev}
            disabled={busy}
            style={{ marginTop: s.canGoNext ? 8 : 16 }}
            icon={<LeftOutlined />}
          >
            上一题
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
          className={current.word.starred ? 'practice-star-action active' : 'practice-star-action'}
          icon={current.word.starred ? <StarFilled /> : <StarOutlined />}
          onClick={s.toggleStarred}
          disabled={busy}
          title={current.word.starred ? '取消星标' : '加星标，方便单独复习'}
        >
          {current.word.starred ? '已星标' : '星标'}
        </Button>
        <Button
          type="text"
          size="small"
          className={s.exampleFavorited ? 'practice-star-action active' : 'practice-star-action'}
          icon={s.exampleFavorited ? <HeartFilled /> : <HeartOutlined />}
          onClick={s.toggleExampleFavorite}
          disabled={busy}
          title={s.exampleFavorited ? '取消收藏这条例句' : '把这条例句收藏到词库'}
        >
          {s.exampleFavorited ? '已收藏例句' : '收藏例句'}
        </Button>
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          onClick={s.regenerateCurrent}
          disabled={judging}
          loading={s.regenerating}
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
