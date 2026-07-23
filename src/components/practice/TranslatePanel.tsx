import { Button, Input } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { ChangeEvent } from 'react';
import MarkableSentence from '@/components/MarkableSentence';
import type { Question } from '@/utils/practiceSelect';
import type { JudgeResult } from '@/hooks/usePracticeSession';

interface Props {
  current: Question;
  userText: string;
  judgeResult: JudgeResult;
  judging: boolean;
  onUserTextChange: (v: string) => void;
  onSubmit: () => void;
}

export default function TranslatePanel({
  current,
  userText,
  judgeResult,
  judging,
  onUserTextChange,
  onSubmit,
}: Props) {
  return (
    <>
      <div className="chinese-sentence">{current.example.zh}</div>
      <Input.TextArea
        value={userText}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onUserTextChange(e.target.value)}
        placeholder="把上面的中文翻译成英文..."
        autoSize={{ minRows: 4, maxRows: 8 }}
        disabled={!!judgeResult}
        style={{ marginTop: 12, fontSize: 16 }}
      />
      <div className="text-light" style={{ fontSize: 12, marginTop: 6 }}>
        提示：用上「{current.word.word}」这个词
        {!judgeResult ? ' · 写完点检查，会显示参考译文' : ''}
      </div>
      {!judgeResult ? (
        <Button
          type="primary"
          block
          onClick={onSubmit}
          style={{ marginTop: 12 }}
          loading={judging}
        >
          检查答案
        </Button>
      ) : (
        <div
          className={`feedback-area show ${judgeResult.correct ? 'correct' : 'wrong'}`}
          style={{ display: 'block' }}
        >
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {judgeResult.correct ? <CheckCircleOutlined /> : <CloseCircleOutlined />}{' '}
            {judgeResult.score ?? 0}/100
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
            <MarkableSentence text={current.example.en} className="practice-ref-sentence" />
            <div className="mark-tip" style={{ marginBottom: 0 }}>
              点句子里不认识的词 → 加入生词表
            </div>
          </div>
        </div>
      )}
    </>
  );
}
