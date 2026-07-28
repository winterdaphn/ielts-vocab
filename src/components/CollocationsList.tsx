import type { Collocation } from '@/types/word';

interface Props {
  items: Collocation[];
  emptyText?: string;
  onRemove?: (phrase: string) => void;
  removeTitle?: string;
}

/** List of fixed collocations / chunks */
export default function CollocationsList({
  items,
  emptyText = '暂无固定搭配',
  onRemove,
  removeTitle = '移除',
}: Props) {
  if (!items.length) {
    return (
      <span className="text-light" style={{ fontSize: 12 }}>
        {emptyText}
      </span>
    );
  }
  return (
    <ul className="collocations-list">
      {items.map((it) => (
        <li key={it.phrase} className={onRemove ? 'collocation-row' : undefined}>
          <span className="collocation-main">
            <b className="collocation-phrase">{it.phrase}</b>
            {it.gloss ? <span className="collocation-gloss"> {it.gloss}</span> : null}
          </span>
          {onRemove ? (
            <button
              type="button"
              className="related-word-remove"
              title={removeTitle}
              aria-label={`${removeTitle} ${it.phrase}`}
              onClick={() => onRemove(it.phrase)}
            >
              ×
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
