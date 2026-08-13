import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserWords } from '@/store/useWords';
import type { RelatedWord } from '@/types/word';
import { wordToId, wordDetailPath } from '@/utils/wordId';
import type { WordDetailNavState } from '@/utils/wordDetailNav';

interface Props {
  items: RelatedWord[];
  emptyText?: string;
  /** Show remove control (e.g. for editable 形近词) */
  onRemove?: (word: string) => void;
  removeTitle?: string;
  /** 未在词表：点击英文词加入（与例句划词相同交互） */
  onAddToBank?: (item: RelatedWord) => void;
  addingKey?: string | null;
  justAddedKey?: string | null;
  /** Show 有道 / AI source chips (default: when any item has source) */
  showSource?: boolean;
  /** 点击词链进入详情时的导航 state（如穿透 / 练习页 returnTo） */
  linkNavState?: WordDetailNavState;
}

function lettersKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export function relatedSourceLabel(
  source?: RelatedWord['source']
): string | null {
  if (source === 'youdao') return '有道';
  if (source === 'ai') return 'AI';
  if (source === 'both') return '有道·AI';
  if (source === 'bank') return '词库';
  if (source === 'manual') return '手加';
  return null;
}

/** Compact list for synonyms / similars in practice & detail */
export default function RelatedWordsList({
  items,
  emptyText = '暂无',
  onRemove,
  removeTitle = '移除',
  onAddToBank,
  addingKey = null,
  justAddedKey = null,
  showSource,
  linkNavState,
}: Props) {
  const navigate = useNavigate();
  const words = useUserWords();
  const idByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of words) {
      const k = lettersKey(w.word);
      if (k && !m.has(k)) m.set(k, w.id || wordToId(w.word));
    }
    return m;
  }, [words]);

  const showBadge =
    showSource ?? items.some((it) => !!relatedSourceLabel(it.source));

  if (!items.length) {
    return (
      <span className="text-light" style={{ fontSize: 12 }}>
        {emptyText}
      </span>
    );
  }
  return (
    <ul className="related-words-list">
      {items.map((it) => {
        const itemKey = lettersKey(it.word);
        const targetId = idByKey.get(itemKey);
        const src = showBadge ? relatedSourceLabel(it.source) : null;
        const isAdding = addingKey === itemKey;
        const justMarked = justAddedKey === itemKey;
        const canClickAdd = !targetId && !!onAddToBank;

        return (
          <li key={it.word} className={onRemove ? 'related-word-row' : undefined}>
            <span className="related-word-main">
              {src ? (
                <span
                  className={`related-source-tag source-${it.source || 'unknown'}`}
                >
                  {src}
                </span>
              ) : null}
              {targetId ? (
                <button
                  type="button"
                  className="related-word-en is-link markable-word in-list"
                  title={`查看「${it.word}」详情`}
                  onClick={() =>
                    navigate(wordDetailPath(targetId), {
                      state: linkNavState,
                    })
                  }
                >
                  {it.word}
                </button>
              ) : canClickAdd ? (
                <button
                  type="button"
                  className={`related-word-en markable-word${justMarked ? ' just-marked' : ''}`}
                  title="点击加入词表"
                  disabled={isAdding}
                  onClick={() => onAddToBank!(it)}
                >
                  {it.word}
                </button>
              ) : (
                <b className="related-word-en">{it.word}</b>
              )}
              {it.gloss ? (
                <span className="related-word-gloss"> — {it.gloss}</span>
              ) : null}
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
