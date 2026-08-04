import type { Derivative } from '@/types/word';

interface Props {
  items: Derivative[];
  emptyText?: string;
}

/** Word-family derivatives (派生/同根词) */
export default function DerivativesList({
  items,
  emptyText = '暂无派生词',
}: Props) {
  if (!items.length) {
    return (
      <span className="text-light" style={{ fontSize: 12 }}>
        {emptyText}
      </span>
    );
  }
  return (
    <ul className="related-words-list derivatives-list">
      {items.map((it) => (
        <li key={`${it.pos || ''}:${it.word}`}>
          <span className="related-word-main">
            {it.pos ? <span className="derivative-pos">{it.pos}</span> : null}
            <b className="related-word-en">{it.word}</b>
            {it.gloss ? (
              <span className="related-word-gloss"> — {it.gloss}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
