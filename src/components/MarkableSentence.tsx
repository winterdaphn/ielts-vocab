import { useState } from 'react';
import { App } from 'antd';
import { useUserWords, useWordsStore, makeNewWord } from '@/store/useWords';
import { useSettings } from '@/store/useSettings';
import { areInflectionVariants, resolveLemma } from '@/utils/inflections';
import { isMarkableToken, normalizeMarkWord } from '@/utils/markWords';
import { lookupWordInfo } from '@/api/llm';
import type { RelatedWord } from '@/types/word';

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
 * Click → look up lemma + add to local word list (like example.html markable-word).
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
    const clicked = normalizeMarkWord(raw);
    if (!isMarkableToken(clicked)) {
      message.info('常见词，不用加入');
      return;
    }

    // Pre-check against clicked form OR local lemma guess
    const localLemma = resolveLemma(clicked);
    const relatedEarly =
      findRelated(clicked) ||
      (localLemma !== clicked ? findRelated(localLemma) : null);
    if (relatedEarly && !relatedEarly.entry.crossedOut) {
      if (relatedEarly.exact && relatedEarly.entry.word.toLowerCase() === clicked) {
        message.info(`「${clicked}」已在词表`);
      } else {
        message.info(
          `词表已有「${relatedEarly.entry.word}」，「${clicked}」是词形变化，无需再加`
        );
      }
      return;
    }

    setBusy(true);
    const hide = message.loading(`正在添加「${clicked}」…`, 0);
    try {
      let lemma = localLemma;
      let formNote = '';
      let translation = '';
      let phonetic = '';
      let phoneticUs = '';
      let phoneticUk = '';
      let partOfSpeech = '';
      let synonyms: RelatedWord[] = [];
      let similars: RelatedWord[] = [];

      if (settings.apiKey) {
        try {
          const info = await lookupWordInfo(clicked, settings);
          lemma = resolveLemma(clicked, info.lemma);
          formNote = info.formNote || '';
          if (info.translation) translation = info.translation;
          if (info.phoneticUs) phoneticUs = info.phoneticUs;
          if (info.phoneticUk) phoneticUk = info.phoneticUk;
          if (info.phonetic) phonetic = info.phonetic;
          if (info.partOfSpeech) partOfSpeech = info.partOfSpeech;
          synonyms = info.synonyms || [];
          similars = info.similars || [];
        } catch {
          /* fall through to free dict */
        }
      }

      // Free dictionary on lemma (better than inflected form)
      if (!translation || !phonetic || !phoneticUs || !phoneticUk) {
        try {
          const resp = await fetch(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lemma)}`
          );
          if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data) && data[0]) {
              phonetic =
                phonetic ||
                data[0].phonetic ||
                data[0].phonetics?.find((p: { text?: string }) => p.text)?.text ||
                '';
              for (const p of data[0].phonetics || []) {
                const t = p?.text || '';
                const a = p?.audio || '';
                if (t && /-us\b|_us_|en-us|us\.mp3/i.test(a) && !phoneticUs) phoneticUs = t;
                if (t && /-uk\b|_uk_|en-uk|uk\.mp3/i.test(a) && !phoneticUk) phoneticUk = t;
              }
              partOfSpeech = partOfSpeech || data[0].meanings?.[0]?.partOfSpeech || '';
              const def = data[0].meanings?.[0]?.definitions?.[0]?.definition;
              if (!translation && def) translation = def;
            }
          }
        } catch {
          /* ignore */
        }
      }

      if (!translation) translation = '（待补充释义）';
      phonetic = phonetic || phoneticUk || phoneticUs;

      const related =
        findRelated(lemma) ||
        (lemma !== clicked ? findRelated(clicked) : null) ||
        relatedEarly;

      if (related?.entry && !related.entry.crossedOut) {
        message.info(
          `词表已有「${related.entry.word}」，「${clicked}」是词形变化，无需再加`
        );
        return;
      }

      if (related?.entry?.crossedOut) {
        await updateWord({
          ...related.entry,
          word: lemma,
          crossedOut: false,
          translation,
          phonetic: phonetic || related.entry.phonetic,
          phoneticUs: phoneticUs || related.entry.phoneticUs,
          phoneticUk: phoneticUk || related.entry.phoneticUk,
          partOfSpeech: partOfSpeech || related.entry.partOfSpeech,
          synonyms: synonyms.length ? synonyms : related.entry.synonyms,
          similars: similars.length ? similars : related.entry.similars,
          nextReview: Date.now(),
        });
      } else {
        await addWord(
          makeNewWord({
            word: lemma,
            translation,
            phonetic,
            phoneticUs,
            phoneticUk,
            partOfSpeech,
            synonyms,
            similars,
          })
        );
      }

      setJustMarked(clicked);
      setTimeout(() => setJustMarked(null), 600);
      if (lemma !== clicked) {
        const note = formNote ? `（${formNote}）` : '';
        message.success(`已加入原形「${lemma}」${note} · 点击的是「${clicked}」`);
      } else {
        message.success(`已加入生词「${lemma}」`);
      }
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
        const related = findRelated(lower) || findRelated(resolveLemma(lower));
        const inList = !!(related && !related.entry.crossedOut);
        // 完形答题前不常显「已在词表」，避免像在提示关键词；揭晓后或普通例句仍显示
        const showInList =
          inList && (blankMode === 'revealed' || !blankWord);
        const tip = related
          ? related.exact
            ? '已在词表'
            : `已有词形「${related.entry.word}」`
          : '点击加入生词（自动还原原形）';

        return (
          <span
            key={i}
            className={`markable-word${showInList ? ' in-list' : ''}${justMarked === lower ? ' just-marked' : ''}`}
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
