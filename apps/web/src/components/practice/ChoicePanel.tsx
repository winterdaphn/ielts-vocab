import { Button } from 'antd';
import type { CSSProperties } from 'react';
import MarkableSentence from '@/components/MarkableSentence';
import SentenceStructureTip from '@/components/practice/SentenceStructureTip';
import CollapsibleTip from '@/components/practice/CollapsibleTip';
import SynonymTipBlock from '@/components/practice/SynonymTipBlock';
import RelatedWordsList from '@/components/RelatedWordsList';
import DerivativesList from '@/components/DerivativesList';
import { resolveClozeChinese, type SentenceStructureAnalysis } from '@/api/llm';
import type { Question } from '@/utils/practiceSelect';
import type { RelatedWord, Derivative } from '@/types/word';

interface Props {
  current: Question;
  showAnswer: boolean;
  hintShown: boolean;
  picked: string | null;
  synonymsTip?: RelatedWord[];
  similarsTip?: RelatedWord[];
  derivativesTip?: Derivative[];
  relatedLoading?: boolean;
  structureTip: SentenceStructureAnalysis | null;
  structureLoading: boolean;
  structureAvailable?: boolean;
  disabled?: boolean;
  onPick: (letter: string) => void;
  onHint: () => void;
  onRequestStructure: () => void;
}

export default function ChoicePanel({
  current,
  showAnswer,
  hintShown,
  picked,
  synonymsTip = [],
  similarsTip = [],
  derivativesTip = [],
  relatedLoading = false,
  structureTip,
  structureLoading,
  structureAvailable = true,
  disabled = false,
  onPick,
  onHint,
  onRequestStructure,
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
        openInListDetail={showAnswer}
      />
      {showZh && zhText ? (
        <div className="chinese-sentence" style={{ marginBottom: 12, marginTop: 12 }}>
          <div className="text-light" style={{ fontSize: 12, marginBottom: 4 }}>
            整句意思
          </div>
          {zhText}
        </div>
      ) : null}
      {!showAnswer && !hintShown && (
        <Button
          block
          size="large"
          onClick={onHint}
          disabled={disabled}
          style={{ marginTop: 12, marginBottom: 12 }}
        >
          提示 · 看整句翻译
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
            <Button
              key={letter}
              block
              onClick={() => onPick(letter)}
              disabled={disabled}
              style={style}
            >
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
            <CollapsibleTip
              title={`「${current.word.word}」词义复习`}
              sectionKey={`meaning:${current.word.id}`}
              defaultOpen
            >
              <div style={{ lineHeight: 1.6 }}>{current.word.translation}</div>
            </CollapsibleTip>
          )}
          {(relatedLoading || synonymsTip.length > 0) && (
            <SynonymTipBlock
              wordId={current.word.id}
              headword={current.word.word}
              translation={current.word.translation}
              synonyms={synonymsTip}
              sentence={current.example.en}
              sectionKey={`synonyms:${current.word.id}`}
              loading={relatedLoading}
            />
          )}
          {(relatedLoading || similarsTip.length > 0) && (
            <CollapsibleTip
              title="形近词"
              sectionKey={`similars:${current.word.id}`}
              defaultOpen={false}
            >
              {relatedLoading && !similarsTip.length ? (
                <span className="text-light" style={{ fontSize: 12 }}>
                  加载中…
                </span>
              ) : (
                <RelatedWordsList items={similarsTip} emptyText="暂无形近词" />
              )}
            </CollapsibleTip>
          )}
          {derivativesTip.length > 0 && (
            <CollapsibleTip
              title="派生词"
              sectionKey={`derivatives:${current.word.id}`}
              defaultOpen={false}
            >
              <DerivativesList items={derivativesTip} emptyText="暂无派生词" />
            </CollapsibleTip>
          )}
          <SentenceStructureTip
            sentenceKey={`${current.word.id}:${current.example.en}`}
            analysis={structureTip}
            loading={structureLoading}
            available={structureAvailable}
            onRequest={onRequestStructure}
          />
        </div>
      )}
    </>
  );
}
