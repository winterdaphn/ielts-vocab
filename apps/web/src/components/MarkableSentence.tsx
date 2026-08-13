import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App } from 'antd';
import { useUserWords, useWordsStore, makeNewWord } from '@/store/useWords';
import { useSettings } from '@/store/useSettings';
import { areInflectionVariants, resolveLemma, isPlausibleLemmaReduction } from '@/utils/inflections';
import { isMarkableToken, normalizeMarkWord } from '@/utils/markWords';
import { resolveLemmaWithAI, suggestCategoriesWithAI, generateRelatedWords, getClozeExpectedForm } from '@/api/llm';
import { lookupYoudaoWord, canUseYoudao } from '@/api/youdao';
import type { Collocation, Derivative, RelatedWord } from '@/types/word';
import { useCategories } from '@/store/useCategories';
import { mergeSynonymSources } from '@/utils/vocabBankRelated';
import { wordDetailPath, wordToId } from '@/utils/wordId';

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
  /** 已揭晓/判题后：词表内单词点击进详情，不再只 toast */
  openInListDetail?: boolean;
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
  openInListDetail = false,
}: Props) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const words = useUserWords();
  const addWord = useWordsStore((s) => s.addWord);
  const updateWord = useWordsStore((s) => s.updateWord);
  const settings = useSettings();
  const allCategories = useCategories((s) => s.all);
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

  function goWordDetail(entry: (typeof words)[0]) {
    const id = entry.id || wordToId(entry.word);
    navigate(wordDetailPath(id));
  }

  async function handleClick(raw: string) {
    if (busy) return;
    const clicked = normalizeMarkWord(raw);
    if (!isMarkableToken(clicked)) {
      message.info('常见词，不用加入');
      return;
    }

    const localLemma = resolveLemma(clicked);
    const relatedEarly =
      findRelated(clicked) ||
      (localLemma !== clicked ? findRelated(localLemma) : null);
    if (relatedEarly && !relatedEarly.entry.crossedOut) {
      if (openInListDetail) {
        goWordDetail(relatedEarly.entry);
        return;
      }
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
      let phoneticUs = '';
      let phoneticUk = '';
      let partOfSpeech = '';
      let synonyms: RelatedWord[] = [];
      let similars: RelatedWord[] = [];
      let derivatives: Derivative[] = [];
      let dictCollocations: Collocation[] = [];

      const canYoudao = canUseYoudao(settings);
      if (settings.apiKey) {
        try {
          const ai = await resolveLemmaWithAI(clicked, settings);
          lemma = ai.lemma || lemma;
          formNote = ai.formNote || '';
          if (!isPlausibleLemmaReduction(clicked, lemma)) {
            lemma = resolveLemma(clicked);
            formNote = '';
          }
        } catch {
          /* keep local lemma */
        }
      }
      if (canYoudao) {
        try {
          const info = await lookupYoudaoWord(clicked, settings);
          lemma = resolveLemma(clicked, info.lemma);
          if (!formNote && info.formNote) formNote = info.formNote;
          if (info.translation) translation = info.translation;
          if (info.phoneticUs) phoneticUs = info.phoneticUs;
          if (info.phoneticUk) phoneticUk = info.phoneticUk;
          if (info.partOfSpeech) partOfSpeech = info.partOfSpeech;
          synonyms = info.synonyms || [];
          derivatives = info.derivatives || [];
          dictCollocations = info.dictCollocations || [];
        } catch {
          /* 有道失败则仅保留词表/AI 能补的信息 */
        }
      }

      if (!translation) translation = '（待补充释义）';

      if (settings.apiKey) {
        try {
          const fromAi = await generateRelatedWords(lemma, translation, settings);
          synonyms = mergeSynonymSources([synonyms, fromAi.synonyms || []], 10);
        } catch {
          /* keep youdao syn */
        }
      }

      let category: string[] = [];
      if (settings.apiKey) {
        try {
          category = await suggestCategoriesWithAI(
            lemma,
            translation,
            settings,
            allCategories()
          );
        } catch {
          category = [];
        }
      }

      const related =
        findRelated(lemma) ||
        (lemma !== clicked ? findRelated(clicked) : null) ||
        relatedEarly;

      if (related?.entry && !related.entry.crossedOut) {
        if (openInListDetail) {
          goWordDetail(related.entry);
          return;
        }
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
          phoneticUs: phoneticUs || related.entry.phoneticUs,
          phoneticUk: phoneticUk || related.entry.phoneticUk,
          partOfSpeech: partOfSpeech || related.entry.partOfSpeech,
          category: category.length ? category : related.entry.category,
          synonyms: synonyms.length ? synonyms : related.entry.synonyms,
          similars: similars.length ? similars : related.entry.similars,
          derivatives: derivatives.length
            ? derivatives
            : related.entry.derivatives,
          dictCollocations: dictCollocations.length
            ? dictCollocations
            : related.entry.dictCollocations,
          nextReview: Date.now(),
        });
      } else {
        await addWord(
          makeNewWord({
            word: lemma,
            translation,
            phoneticUs,
            phoneticUk,
            partOfSpeech,
            category,
            synonyms,
            similars,
            derivatives,
            dictCollocations,
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

  function escapeReg(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function renderBlank(part: string, key: string) {
    if (blankMode === 'input') {
      return (
        <input
          key={key}
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
      <span key={key} className={`cloze-blank ${blankMode === 'revealed' ? 'revealed' : ''}`}>
        {blankMode === 'revealed' ? part : '　'}
      </span>
    );
  }

  function renderTextParts(segment: string, keyPrefix: string) {
    const parts = segment.split(/(\b)/);
    return parts.map((part, i) => {
      if (!part) return null;

      if (!/^[A-Za-z][A-Za-z'-]*$/.test(part) || !isMarkableToken(part)) {
        return <span key={`${keyPrefix}-${i}`}>{part}</span>;
      }

      const lower = part.toLowerCase();
      const related = findRelated(lower) || findRelated(resolveLemma(lower));
      const inList = !!(related && !related.entry.crossedOut);
      const showInList =
        inList && (blankMode === 'revealed' || !blankWord);
      const tip = related
        ? related.exact
          ? openInListDetail
            ? '已在词表 · 点击查看详情'
            : '已在词表'
          : openInListDetail
            ? `词表已有「${related.entry.word}」· 点击查看`
            : `已有词形「${related.entry.word}」`
        : '点击加入生词（自动还原原形）';

      return (
        <span
          key={`${keyPrefix}-${i}`}
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
    });
  }

  if (blankWord) {
    const token = getClozeExpectedForm(blankWord, text) || blankWord;
    const match = new RegExp(escapeReg(token), 'i').exec(text);
    if (match && match.index !== undefined) {
      const before = text.slice(0, match.index);
      const blankPart = match[0];
      const after = text.slice(match.index + blankPart.length);
      return (
        <div className={className}>
          {renderTextParts(before, 'b')}
          {renderBlank(blankPart, 'blank')}
          {renderTextParts(after, 'a')}
        </div>
      );
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
            ? openInListDetail
              ? '已在词表 · 点击查看详情'
              : '已在词表'
            : openInListDetail
              ? `词表已有「${related.entry.word}」· 点击查看`
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
