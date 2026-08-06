import { Button, Input } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, BulbOutlined } from '@ant-design/icons';
import type { ChangeEvent } from 'react';
import MarkableSentence from '@/components/MarkableSentence';
import type { Question } from '@/utils/practiceSelect';
import type { JudgeResult } from '@/hooks/usePracticeSession';
import type { TranslateHints } from '@/api/llm';

interface Props {
  current: Question;
  userText: string;
  judgeResult: JudgeResult;
  judging: boolean;
  hintLevel: number;
  hints: TranslateHints | null;
  hintLoading: boolean;
  onUserTextChange: (v: string) => void;
  onHint: () => void;
  onSubmit: () => void;
}

function hintButtonLabel(level: number): string {
  if (level <= 0) return 'AI 提示 · 结构';
  if (level === 1) return '再提示 · 关键词';
  if (level === 2) return '显示答案';
  return '已显示答案';
}

export default function TranslatePanel({
  current,
  userText,
  judgeResult,
  judging,
  hintLevel,
  hints,
  hintLoading,
  onUserTextChange,
  onHint,
  onSubmit,
}: Props) {
  const locked = !!judgeResult;

  return (
    <>
      <div className="chinese-sentence">{current.example.zh}</div>
      <Input.TextArea
        value={userText}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onUserTextChange(e.target.value)}
        placeholder="把上面的中文翻译成英文..."
        autoSize={{ minRows: 4, maxRows: 8 }}
        disabled={locked}
        style={{ marginTop: 12, fontSize: 16 }}
      />
      <div className="text-light" style={{ fontSize: 12, marginTop: 6 }}>
        提示：用上「{current.word.word}」这个词
        {!judgeResult ? ' · 可分步点 AI 提示（结构 → 关键词 → 答案）' : ''}
      </div>

      {(hintLevel >= 1 || hintLoading) && !judgeResult && (
        <div className="translate-hints">
          {hintLoading && hintLevel < 1 && (
            <div className="translate-hint-block">
              <div className="translate-hint-label">正在生成结构提示…</div>
            </div>
          )}
          {hintLevel >= 1 && hints?.structure && (
            <div className="translate-hint-block">
              <div className="translate-hint-label">① 大致结构</div>
              <div className="translate-hint-body">{hints.structure}</div>
            </div>
          )}
          {hintLevel >= 2 && hints?.keywords && (
            <div className="translate-hint-block">
              <div className="translate-hint-label">② 关键词 / 搭配</div>
              <div className="translate-hint-body">{hints.keywords}</div>
            </div>
          )}
          {hintLevel >= 3 && (
            <div className="translate-hint-block answer">
              <div className="translate-hint-label">③ 参考译文</div>
              <MarkableSentence
                text={current.example.en}
                className="practice-ref-sentence"
                openInListDetail
              />
              <div className="mark-tip" style={{ marginBottom: 0 }}>
                点句子里不认识的词 → 加入生词表
              </div>
            </div>
          )}
        </div>
      )}

      {!judgeResult ? (
        <div className="flex-row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {hintLevel < 3 && (
            <Button
              icon={<BulbOutlined />}
              onClick={onHint}
              loading={hintLoading}
              disabled={judging}
              style={{ flex: 1, minWidth: 120 }}
            >
              {hintButtonLabel(hintLevel)}
            </Button>
          )}
          <Button
            type="primary"
            onClick={onSubmit}
            loading={judging}
            disabled={hintLevel >= 3}
            style={{ flex: 1, minWidth: 120 }}
          >
            {hintLevel >= 3 ? '已看答案' : '检查答案'}
          </Button>
        </div>
      ) : (
        <div
          className={`feedback-area show ${judgeResult.correct ? 'correct' : 'wrong'}`}
          style={{ display: 'block' }}
        >
          {hintLevel >= 1 && hints && (
            <div className="translate-hints" style={{ marginBottom: 10 }}>
              {hints.structure && (
                <div className="translate-hint-block">
                  <div className="translate-hint-label">① 大致结构</div>
                  <div className="translate-hint-body">{hints.structure}</div>
                </div>
              )}
              {hintLevel >= 2 && hints.keywords && (
                <div className="translate-hint-block">
                  <div className="translate-hint-label">② 关键词 / 搭配</div>
                  <div className="translate-hint-body">{hints.keywords}</div>
                </div>
              )}
            </div>
          )}
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {judgeResult.correct ? <CheckCircleOutlined /> : <CloseCircleOutlined />}{' '}
            {judgeResult.revealed ? '已显示答案' : `${judgeResult.score ?? 0}/100`}
          </div>
          <div style={{ marginTop: 8 }}>{judgeResult.feedback}</div>
          {judgeResult.improved && (
            <div style={{ marginTop: 8 }}>
              <b>改进：</b>
              {judgeResult.improved}
            </div>
          )}
          <div style={{ marginTop: 10, padding: 12, background: 'var(--bg)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 4 }}>参考译文</div>
            <MarkableSentence
              text={current.example.en}
              className="practice-ref-sentence"
              openInListDetail
            />
            <div className="mark-tip" style={{ marginBottom: 0 }}>
              点句子里不认识的词 → 加入生词表
            </div>
          </div>
        </div>
      )}
    </>
  );
}

