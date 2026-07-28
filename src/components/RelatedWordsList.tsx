import type { RelatedWord } from '@/types/word';

interface Props {
  items: RelatedWord[];
  emptyText?: string;
  /** Show remove control (e.g. for editable 形近词) */
  onRemove?: (word: string) => void;
  removeTitle?: string;
}

/** Compact list for synonyms / similars in practice & detail */
export default function RelatedWordsList({
  items,
  emptyText = '暂无',
  onRemove,
  removeTitle = '移除',
}: Props) {
  if (!items.length) {
    return <span className="text-light" style={{ fontSize: 12 }}>{emptyText}</span>;
  }
  return (
    <ul className="related-words-list">
      {items.map((it) => (
        <li key={it.word} className={onRemove ? 'related-word-row' : undefined}>
          <span className="related-word-main">
            <b className="related-word-en">{it.word}</b>
            {it.gloss ? <span className="related-word-gloss"> — {it.gloss}</span> : null}
          </span>
          {onRemove ? (
            <button
              type="button"
              className="related-word-remove"
              title={removeTitle}
              aria-label={`${removeTitle} ${it.word}`}
              onClick={() => onRemove(it.word)}
            >
              ×
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function relatedSummaryLine(
  synonyms?: RelatedWord[] | null,
  similars?: RelatedWord[] | null
): string {
  const syn = (synonyms || []).map((s) => s.word).filter(Boolean);
  const sim = (similars || []).map((s) => s.word).filter(Boolean);
  const parts: string[] = [];
  if (syn.length) parts.push(`近: ${syn.slice(0, 3).join(' / ')}`);
  if (sim.length) parts.push(`形近: ${sim.slice(0, 3).join(' / ')}`);
  return parts.join(' · ');
}
