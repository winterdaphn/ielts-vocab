import { Button } from 'antd';
import type { CSSProperties } from 'react';
import MarkableSentence from '@/components/MarkableSentence';
import SentenceStructureTip from '@/components/practice/SentenceStructureTip';
import { resolveClozeChinese, type SentenceStructureAnalysis } from '@/api/llm';
import type { Question } from '@/utils/practiceSelect';

interface Props {
  current: Question;
  showAnswer: boolean;
  hintShown: boolean;
  picked: string | null;
  structureTip: SentenceStructureAnalysis | null;
  structureLoading: boolean;
  onPick: (letter: string) => void;
  onHint: () => void;
}

export default function ChoicePanel({
  current,
  showAnswer,
  hintShown,
  picked,
  structureTip,
  structureLoading,
  onPick,
  onHint,
}: Props) {
  const showZh = showAnswer || hintShown;
  const zhText = current.example.zh
    ? resolveClozeChinese(current.example.zh, current.word).text
    : '';
  const correct = showAnswer && picked === current.example.answer;

  return (
    <>
      <MarkableSentence
        text={current.example.en}
        blankWord={current.example.blank || current.word.word}
        blankMode={showAnswer ? 'revealed' : 'hidden'}
      />
      <div className="mark-tip">点句子里不认识的词 → 加入生词表</div>
      {showZh && zhText ? (
        <div className="chinese-sentence" style={{ marginBottom: 12 }}>
          <div className="text-light" style={{ fontSize: 12, marginBottom: 4 }}>
            整句意思
          </div>
          {zhText}
        </div>
      ) : (
        <div className="text-light" style={{ fontSize: 12, marginBottom: 12, opacity: 0.55 }}>
          需要帮助？点「提示」看整句翻译
        </div>
      )}
      {!showAnswer && !hintShown && (
        <Button block size="large" onClick={onHint} style={{ marginBottom: 12 }}>
          提示
        </Button>
      )}
      <div className="cloze-options">
        {(['A', 'B', 'C', 'D'] as const).map((letter) => {
          const opt = current.example[`choice${letter}` as 'choiceA'];
          if (!opt) return null;
          const isPicked = picked === letter;
          const isCorrect = current.example.answer === letter;
          let style: CSSProperties = {};
          if (showAnswer && isCorrect)
            style = { background: 'var(--accent-light)', borderColor: 'var(--accent)' };
          else if (showAnswer && isPicked && !isCorrect)
            style = { background: 'var(--error-light)', borderColor: 'var(--error)' };
          return (
            <Button key={letter} block onClick={() => onPick(letter)} style={style}>
              {letter}. {opt}
            </Button>
          );
        })}
      </div>
      {showAnswer && (
        <div
          className={`feedback-area show ${correct ? 'correct' : 'wrong'}`}
          style={{ display: 'block', marginTop: 12 }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {correct ? '✓ 正确' : '✗ 不对'}
          </div>
          <div>
            本题答案是{' '}
            <b>
              {current.example.answer}.{' '}
              {current.example[`choice${current.example.answer}` as 'choiceA']}
            </b>
          </div>
          {current.word.translation && (
            <div className="suggestion" style={{ marginTop: 8 }}>
              <div className="text-light" style={{ fontSize: 12, marginBottom: 2 }}>
                「{current.word.word}」词义复习
              </div>
              <div style={{ lineHeight: 1.6 }}>{current.word.translation}</div>
            </div>
          )}
          <SentenceStructureTip analysis={structureTip} loading={structureLoading} />
        </div>
      )}
    </>
  );
}
