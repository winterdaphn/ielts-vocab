import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserWords } from '@/store/useWords';
import type { RelatedWord } from '@/types/word';

interface Props {
  items: RelatedWord[];
  emptyText?: string;
  /** Show remove control (e.g. for editable 形近词) */
  onRemove?: (word: string) => void;
  removeTitle?: string;
}

function lettersKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Compact list for synonyms / similars in practice & detail */
export default function RelatedWordsList({
  items,
  emptyText = '暂无',
  onRemove,
  removeTitle = '移除',
}: Props) {
  const navigate = useNavigate();
  const words = useUserWords();
  const idByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of words) {
      const k = lettersKey(w.word);
      if (k && !m.has(k)) m.set(k, w.id);
    }
    return m;
  }, [words]);

  if (!items.length) {
    return <span className="text-light" style={{ fontSize: 12 }}>{emptyText}</span>;
  }
  return (
    <ul className="related-words-list">
      {items.map((it) => {
        const targetId = idByKey.get(lettersKey(it.word));
        return (
          <li key={it.word} className={onRemove ? 'related-word-row' : undefined}>
            <span className="related-word-main">
              {targetId ? (
                <button
                  type="button"
                  className="related-word-en is-link"
                  title={`查看「${it.word}」详情`}
                  onClick={() => navigate(`/words/${targetId}`)}
                >
                  {it.word}
                </button>
              ) : (
                <b className="related-word-en">{it.word}</b>
              )}
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
        );
      })}
    </ul>
  );
}

export function relatedSummaryLine(
  synonyms?: RelatedWord[] | null | unknown,
  similars?: RelatedWord[] | null | unknown
): string {
  const toWords = (list: unknown): string[] => {
    if (!Array.isArray(list)) return [];
    return list
      .map((s) => {
        if (!s) return '';
        if (typeof s === 'string') return s.trim();
        if (typeof s === 'object' && s !== null && 'word' in s) {
          return String((s as RelatedWord).word || '').trim();
        }
        return '';
      })
      .filter(Boolean);
  };
  const syn = toWords(synonyms);
  const sim = toWords(similars);
  const parts: string[] = [];
  if (syn.length) parts.push(`近: ${syn.slice(0, 3).join(' / ')}`);
  if (sim.length) parts.push(`形近: ${sim.slice(0, 3).join(' / ')}`);
  return parts.join(' · ');
}
