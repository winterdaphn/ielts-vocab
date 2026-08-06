import type { Collocation } from '@/types/word';
import { normalizePhraseKey } from '@/types/chunk';

interface Props {
  items: Collocation[];
  emptyText?: string;
  onRemove?: (phrase: string) => void;
  removeTitle?: string;
  /** Phrase keys already in 搭配本 */
  deckPhraseKeys?: Set<string>;
  onAddToDeck?: (item: Collocation) => void;
  onOpenInDeck?: (phraseKey: string) => void;
}

/** List of fixed collocations / chunks */
export default function CollocationsList({
  items,
  emptyText = '暂无固定搭配',
  onRemove,
  removeTitle = '移除',
  deckPhraseKeys,
  onAddToDeck,
  onOpenInDeck,
}: Props) {
  if (!items.length) {
    return (
      <span className="text-light" style={{ fontSize: 12 }}>
        {emptyText}
      </span>
    );
  }
  const showDeck = !!(onAddToDeck || onOpenInDeck);
  return (
    <ul className="collocations-list">
      {items.map((it) => {
        const key = normalizePhraseKey(it.phrase);
        const inDeck = deckPhraseKeys?.has(key);
        return (
          <li
            key={it.phrase}
            className={onRemove || showDeck ? 'collocation-row' : undefined}
          >
            <span className="collocation-main">
              <b className="collocation-phrase">{it.phrase}</b>
              {it.gloss ? <span className="collocation-gloss"> {it.gloss}</span> : null}
            </span>
            <span className="collocation-actions">
              {showDeck ? (
                inDeck ? (
                  <button
                    type="button"
                    className="related-word-remove"
                    title="已在搭配本 · 查看"
                    onClick={() => onOpenInDeck?.(key)}
                  >
                    已加入
                  </button>
                ) : (
                  <button
                    type="button"
                    className="related-word-remove"
                    title="加入搭配本"
                    onClick={() => onAddToDeck?.(it)}
                  >
                    +
                  </button>
                )
              ) : null}
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
            </span>
          </li>
        );
      })}
    </ul>
  );
}
