import { useEffect } from 'react';
import { generateMnemonicTip, generateRelatedWords } from '@/api/llm';
import { lookupYoudaoWord, canUseYoudao } from '@/api/youdao';
import { getRelatedFromBank, mergeSynonymSources, getBankLexisExtras, ensureVocabBankRelated } from '@/utils/vocabBankRelated';
import type { Settings } from '@/types/settings';
import type { RelatedWord, Derivative, Word } from '@/types/word';
import type { Mode, Question } from '@/utils/practiceSelect';

interface TipsEffectParams {
  mode: Mode;
  showAnswer: boolean;
  current: Question | null;
  idx: number;
  mnemonicTip: string;
  synonymsTip: RelatedWord[];
  similarsTip: RelatedWord[];
  derivativesTip: Derivative[];
  settings: Settings;
  setMnemonicTip: (v: string) => void;
  setMnemonicLoading: (v: boolean) => void;
  setSynonymsTip: (v: RelatedWord[]) => void;
  setSimilarsTip: (v: RelatedWord[]) => void;
  setDerivativesTip: (v: Derivative[]) => void;
  setRelatedLoading: (v: boolean) => void;
  updateWord: (word: Word) => Promise<void>;
}

/** 揭晓后加载助记 / 近义 / 形近提示 */
export function usePracticeTipsEffects({
  mode,
  showAnswer,
  current,
  idx,
  mnemonicTip,
  synonymsTip,
  similarsTip,
  derivativesTip,
  settings,
  setMnemonicTip,
  setMnemonicLoading,
  setSynonymsTip,
  setSimilarsTip,
  setDerivativesTip,
  setRelatedLoading,
  updateWord,
}: TipsEffectParams) {
  useEffect(() => {
    if (mode !== 'cloze' || !showAnswer || !current) return;
    if (mnemonicTip) {
      setMnemonicLoading(false);
      return;
    }
    const word = current.word;
    const existing = String(word.mnemonic || '').trim();
    if (existing) {
      setMnemonicTip(existing);
      setMnemonicLoading(false);
      return;
    }
    if (!settings.apiKey) {
      setMnemonicTip('');
      setMnemonicLoading(false);
      return;
    }

    let cancelled = false;
    setMnemonicLoading(true);
    void (async () => {
      try {
        const tip = await generateMnemonicTip(word.word, settings);
        if (cancelled) return;
        if (tip) {
          setMnemonicTip(tip);
          await updateWord({ ...word, mnemonic: tip });
        }
      } catch {
        /* ignore generate failures */
      } finally {
        if (!cancelled) setMnemonicLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showAnswer, current?.word.id, idx]);

  useEffect(() => {
    if ((mode !== 'cloze' && mode !== 'choice') || !showAnswer || !current) {
      return;
    }
    if (synonymsTip.length > 0 || similarsTip.length > 0 || derivativesTip.length > 0) {
      setRelatedLoading(false);
      return;
    }
    const word = current.word;
    const cachedSyn = Array.isArray(word.synonyms) ? word.synonyms : [];
    const cachedSim = Array.isArray(word.similars) ? word.similars : [];

    let cancelled = false;
    setRelatedLoading(true);
    void (async () => {
      await ensureVocabBankRelated();
      if (cancelled) return;
      const bankExtras = getBankLexisExtras(word.word);
      const deriv =
        Array.isArray(word.derivatives) && word.derivatives.length
          ? word.derivatives
          : bankExtras.derivatives;
      setDerivativesTip(deriv);

      if (cachedSyn.length || cachedSim.length) {
        setSynonymsTip(cachedSyn);
        setSimilarsTip(cachedSim);
        setRelatedLoading(false);
        return;
      }

      setSynonymsTip([]);
      setSimilarsTip([]);
      try {
        const fromBank = getRelatedFromBank(word.word, word.translation || '');
        let youdaoSyn = fromBank.synonyms;
        const similars = fromBank.similars;
        if (canUseYoudao(settings)) {
          try {
            const yd = await lookupYoudaoWord(word.word, settings);
            if (yd.synonyms?.length) youdaoSyn = yd.synonyms;
          } catch {
            /* keep bank */
          }
        }
        const baseSynonyms = mergeSynonymSources([youdaoSyn], 10);
        let aiSyn: RelatedWord[] = [];
        if (settings.apiKey && baseSynonyms.length < 3) {
          try {
            const fromAi = await generateRelatedWords(
              word.word,
              word.translation || '',
              settings
            );
            aiSyn = fromAi.synonyms || [];
          } catch {
            /* keep youdao/bank */
          }
        }
        const synonyms = mergeSynonymSources([baseSynonyms, aiSyn], 10);
        if (cancelled) return;
        setSynonymsTip(synonyms);
        setSimilarsTip(similars);
        if (synonyms.length || similars.length) {
          await updateWord({
            ...word,
            synonyms,
            similars,
          });
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setRelatedLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showAnswer, current?.word.id, idx]);
}
