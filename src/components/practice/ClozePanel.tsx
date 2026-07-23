import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { SoundOutlined } from '@ant-design/icons';
import MarkableSentence from '@/components/MarkableSentence';
import SpeakButton from '@/components/SpeakButton';
import SentenceStructureTip from '@/components/practice/SentenceStructureTip';
import type { Question } from '@/utils/practiceSelect';
import type { JudgeResult } from '@/hooks/usePracticeSession';
import { speakEnglish, stopSpeaking } from '@/utils/speak';
import { resolveClozeChinese, type SentenceStructureAnalysis } from '@/api/llm';
import type { Word } from '@/types/word';

interface Props {
  current: Question;
  showAnswer: boolean;
  hintShown: boolean;
  userText: string;
  judgeResult: JudgeResult;
  mnemonicTip: string;
  mnemonicLoading: boolean;
  structureTip: SentenceStructureAnalysis | null;
  structureLoading: boolean;
  judging: boolean;
  onUserTextChange: (v: string) => void;
  onHint: () => void;
  onSubmit: () => void;
}

function ClozeChineseMeaning({ zh, word }: { zh: string; word: Word }) {
  const { text } = resolveClozeChinese(zh, word);
  return (
    <div className="chinese-sentence" style={{ marginBottom: 12 }}>
      <div className="text-light" style={{ fontSize: 12, marginBottom: 4 }}>
        整句意思
      </div>
      {text}
    </div>
  );
}

export default function ClozePanel({
  current,
  showAnswer,
  hintShown,
  userText,
  judgeResult,
  mnemonicTip,
  mnemonicLoading,
  structureTip,
  structureLoading,
  judging,
  onUserTextChange,
  onHint,
  onSubmit,
}: Props) {
  const [speaking, setSpeaking] = useState(false);

  // Stop TTS when leaving this question / hiding the button
  useEffect(() => {
    return () => {
      stopSpeaking();
      setSpeaking(false);
    };
  }, [current.word.id, showAnswer]);

  function handleSpeak() {
    const text = current.example.en;
    if (!text?.trim()) return;
    speakEnglish(text, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
    });
  }

  const sentence = (
    <MarkableSentence
      text={current.example.en}
      blankWord={current.example.blank || current.word.word}
      blankMode={showAnswer ? 'revealed' : 'input'}
      blankValue={userText}
      onBlankChange={onUserTextChange}
      blankDisabled={showAnswer || judging}
      onBlankEnter={onSubmit}
      className="practice-sentence"
    />
  );

  return (
    <>
      {showAnswer ? (
        <div className="sentence-row">
          {sentence}
          <button
            type="button"
            className={`speak-sentence-btn${speaking ? ' speaking' : ''}`}
            title="朗读整句"
            aria-label="朗读整句"
            onClick={handleSpeak}
          >
            <SoundOutlined />
          </button>
        </div>
      ) : (
        sentence
      )}
      <div className="mark-tip">点句子里不认识的词 → 加入生词表</div>
      {showAnswer || hintShown ? (
        current.example.zh ? (
          <ClozeChineseMeaning zh={current.example.zh} word={current.word} />
        ) : null
      ) : (
        <div className="text-light" style={{ fontSize: 12, marginBottom: 12, opacity: 0.55 }}>
          需要帮助？点「提示」看整句翻译
        </div>
      )}
      {!showAnswer ? (
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          {!hintShown && (
            <Button size="large" onClick={onHint} disabled={judging} style={{ flex: 1 }}>
              提示
            </Button>
          )}
          <Button
            type="primary"
            size="large"
            onClick={onSubmit}
            loading={judging}
            style={{ flex: 1 }}
          >
            检查答案
          </Button>
        </div>
      ) : (
        judgeResult && (
          <div
            className={`feedback-area show ${
              judgeResult.revealed ? '' : judgeResult.correct ? 'correct' : 'wrong'
            }`}
            style={{ display: 'block' }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {judgeResult.revealed
                ? '已显示答案'
                : judgeResult.correct
                  ? '✓ 正确'
                  : '✗ 不对'}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              本题答案是{' '}
              <b>{judgeResult.expected || current.example.blank || current.word.word}</b>
              <SpeakButton
                text={judgeResult.expected || current.example.blank || current.word.word}
                title="复习读音"
              />
            </div>
            {!judgeResult.revealed && judgeResult.feedback && (
              <div style={{ marginTop: 6 }}>{judgeResult.feedback}</div>
            )}
            {judgeResult.wordCompare && (
              <div className="suggestion" style={{ marginTop: 8 }}>
                <div className="text-light" style={{ fontSize: 12 }}>用词对比</div>
                {judgeResult.wordCompare}
              </div>
            )}
            {judgeResult.usageTip && (
              <div className="suggestion" style={{ marginTop: 8 }}>
                <div className="text-light" style={{ fontSize: 12 }}>使用习惯</div>
                {judgeResult.usageTip}
              </div>
            )}
            {judgeResult.grammarTip && (
              <div className="suggestion" style={{ marginTop: 8 }}>
                <div className="text-light" style={{ fontSize: 12 }}>语法纠正</div>
                {judgeResult.grammarTip}
              </div>
            )}
            <SentenceStructureTip analysis={structureTip} loading={structureLoading} />
            {current.word.translation && (
              <div className="suggestion" style={{ marginTop: 8 }}>
                <div className="text-light" style={{ fontSize: 12, marginBottom: 2 }}>
                  「{current.word.word}」词义复习
                </div>
                <div style={{ lineHeight: 1.6 }}>{current.word.translation}</div>
              </div>
            )}
            {(mnemonicLoading || mnemonicTip) && (
              <div className="suggestion cloze-mnemonic" style={{ marginTop: 8 }}>
                {mnemonicLoading && !mnemonicTip ? (
                  <span className="text-light" style={{ fontSize: 12 }}>
                    助记加载中…
                  </span>
                ) : (
                  <>
                    <div className="text-light" style={{ fontSize: 12, marginBottom: 2 }}>
                      💡 助记 · 词根词缀
                    </div>
                    <div style={{ lineHeight: 1.65 }}>{mnemonicTip}</div>
                  </>
                )}
              </div>
            )}
          </div>
        )
      )}
    </>
  );
}
