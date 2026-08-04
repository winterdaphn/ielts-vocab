import { Button } from 'antd';
import CollapsibleTip from '@/components/practice/CollapsibleTip';
import type { SentenceStructureAnalysis } from '@/api/llm';

interface Props {
  /** Reset collapse when question changes */
  sentenceKey: string;
  analysis: SentenceStructureAnalysis | null;
  loading: boolean;
  /** False when no API key */
  available?: boolean;
  onRequest: () => void;
}

/** AI 句型拆解 — 与词义/助记同一套标题 + 查看/收起 */
export default function SentenceStructureTip({
  sentenceKey,
  analysis,
  loading,
  available = true,
  onRequest,
}: Props) {
  if (!available) return null;

  return (
    <CollapsibleTip
      title="AI 句型分析"
      sectionKey={sentenceKey}
      defaultOpen={false}
      onOpen={() => {
        if (!analysis && !loading) onRequest();
      }}
    >
      {loading && !analysis ? (
        <span className="text-light" style={{ fontSize: 12 }}>
          正在分析句子结构…
        </span>
      ) : analysis ? (
        <div style={{ lineHeight: 1.65, fontSize: 13.5 }}>
          {analysis.overview && (
            <div style={{ marginBottom: analysis.clauses ? 6 : 0, whiteSpace: 'pre-wrap' }}>
              <span style={{ color: 'var(--text-light)', fontSize: 12 }}>主干：</span>
              {analysis.overview}
            </div>
          )}
          {analysis.clauses && (
            <div style={{ whiteSpace: 'pre-wrap' }}>
              <span style={{ color: 'var(--text-light)', fontSize: 12 }}>层次：</span>
              {analysis.clauses}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12 }}>
          <span className="text-light">暂无分析结果，</span>
          <Button
            type="text"
            size="small"
            onClick={onRequest}
            style={{ padding: 0, height: 'auto' }}
          >
            点此重试
          </Button>
        </div>
      )}
    </CollapsibleTip>
  );
}
