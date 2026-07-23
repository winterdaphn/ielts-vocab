import type { SentenceStructureAnalysis } from '@/api/llm';

interface Props {
  analysis: SentenceStructureAnalysis | null;
  loading: boolean;
}

/** AI 句型拆解 — shown after cloze / choice answer reveal. */
export default function SentenceStructureTip({ analysis, loading }: Props) {
  if (!loading && !analysis) return null;

  return (
    <div className="suggestion sentence-structure" style={{ marginTop: 8 }}>
      <div className="text-light" style={{ fontSize: 12, marginBottom: 4 }}>
        AI 句型分析
      </div>
      {loading && !analysis ? (
        <span className="text-light" style={{ fontSize: 12 }}>
          正在分析句子结构…
        </span>
      ) : (
        analysis && (
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
        )
      )}
    </div>
  );
}
