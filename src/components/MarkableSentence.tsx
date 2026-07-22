import { useState } from 'react';
import { App } from 'antd';
import { useUserWords, useWordsStore, makeNewWord } from '@/store/useWords';
import { useSettings } from '@/store/useSettings';
import { areInflectionVariants } from '@/utils/inflections';
import { isMarkableToken, normalizeMarkWord } from '@/utils/markWords';
import { lookupWordInfo } from '@/api/llm';

interface Props {
  text: string;
  /** Word currently being practiced — render as blank, not clickable */
  blankWord?: string;
  /** hidden = underline blank; input = type-in; revealed = show answer */
  blankMode?: 'hidden' | 'input' | 'revealed';
  blankValue?: string;
  onBlankChange?: (v: string) => void;
  blankDisabled?: boolean;
  onBlankEnter?: () => void;
  className?: string;
}

/**
 * Renders an English sentence with clickable content words.
 * Click → look up + add to local word list (like example.html markable-word).
 */
export default function MarkableSentence({
  text,
  blankWord,
  blankMode = 'hidden',
  blankValue = '',
  onBlankChange,
  blankDisabled = false,
  onBlankEnter,
  className = 'cloze-sentence',
}: Props) {
  const { message } = App.useApp();
  const words = useUserWords();
  const addWord = useWordsStore((s) => s.addWord);
  const updateWord = useWordsStore((s) => s.updateWord);
  const settings = useSettings();
  const [justMarked, setJustMarked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function findRelated(raw: string) {
    const target = normalizeMarkWord(raw);
    let inflectionHit: { entry: (typeof words)[0]; exact: boolean } | null = null;
    for (const w of words) {
      if (!w.word) continue;
      const existing = w.word.toLowerCase();
      if (existing === target) return { entry: w, exact: true };
      if (!inflectionHit && areInflectionVariants(existing, target)) {
        inflectionHit = { entry: w, exact: false };
      }
    }
    return inflectionHit;
  }

  async function handleClick(raw: string) {
    if (busy) return;
    const word = normalizeMarkWord(raw);
    if (!isMarkableToken(word)) {
      message.info('常见词，不用加入');
      return;
    }

    const related = findRelated(word);
    if (related && !related.entry.crossedOut) {
      if (related.exact) message.info(`「${word}」已在词表`);
      else message.info(`词表已有「${related.entry.word}」，「${word}」是词形变化，无需再加`);
      return;
    }

    setBusy(true);
    const hide = message.loading(`正在添加「${word}」…`, 0);
    try {
      let translation = '';
      let phonetic = '';
      let partOfSpeech = '';

      // Free dictionary API (same as example.html)
      try {
        const resp = await fetch(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
        );
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data[0]) {
            phonetic = data[0].phonetic || data[0].phonetics?.find((p: { text?: string }) => p.text)?.text || '';
            partOfSpeech = data[0].meanings?.[0]?.partOfSpeech || '';
            const def = data[0].meanings?.[0]?.definitions?.[0]?.definition;
            if (def) translation = def;
          }
        }
      } catch {
        /* ignore */
      }

      if (settings.apiKey) {
        try {
          const info = await lookupWordInfo(word, settings);
          if (info.translation) translation = info.translation;
          if (info.phonetic) phonetic = phonetic || info.phonetic;
          if (info.partOfSpeech) partOfSpeech = partOfSpeech || info.partOfSpeech;
        } catch {
          /* ignore */
        }
      }

      if (!translation) translation = '（待补充释义）';

      if (related?.entry?.crossedOut) {
        await updateWord({
          ...related.entry,
          crossedOut: false,
          translation,
          phonetic: phonetic || related.entry.phonetic,
          partOfSpeech: partOfSpeech || related.entry.partOfSpeech,
          nextReview: Date.now(),
        });
      } else {
        await addWord(
          makeNewWord({
            word,
            translation,
            phonetic,
            partOfSpeech,
          })
        );
      }

      setJustMarked(word);
      setTimeout(() => setJustMarked(null), 600);
      message.success(`已加入生词「${word}」`);
    } catch (e) {
      message.error('添加失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      hide();
      setBusy(false);
    }
  }

  const blankLower = (blankWord || '').toLowerCase();
  const parts = text.split(/(\b)/);

  return (
    <div className={className}>
      {parts.map((part, i) => {
        if (!part) return null;

        // Practice blank target
        if (blankWord && part.toLowerCase() === blankLower) {
          if (blankMode === 'input') {
            return (
              <input
                key={i}
                type="text"
                className="blank-input"
                value={blankValue}
                disabled={blankDisabled}
                placeholder="填入单词"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                onChange={(e) => onBlankChange?.(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onBlankEnter?.();
                  }
                }}
              />
            );
          }
          return (
            <span key={i} className={`cloze-blank ${blankMode === 'revealed' ? 'revealed' : ''}`}>
              {blankMode === 'revealed' ? part : '　'}
            </span>
          );
        }

        if (!/^[A-Za-z][A-Za-z'-]*$/.test(part) || !isMarkableToken(part)) {
          return <span key={i}>{part}</span>;
        }

        const lower = part.toLowerCase();
        const related = findRelated(lower);
        const inList = !!(related && !related.entry.crossedOut);
        const tip = related
          ? related.exact
            ? '已在词表'
            : `已有词形「${related.entry.word}」`
          : '点击加入生词';

        return (
          <span
            key={i}
            className={`markable-word${inList ? ' in-list' : ''}${justMarked === lower ? ' just-marked' : ''}`}
            title={tip}
            role="button"
            tabIndex={0}
            onClick={() => handleClick(part)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick(part);
              }
            }}
          >
            {part}
          </span>
        );
      })}
    </div>
  );
}
