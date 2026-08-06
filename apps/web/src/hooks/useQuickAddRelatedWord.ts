import { useState } from 'react';
import { App } from 'antd';
import { useUserWords, useWordsStore, makeNewWord } from '@/store/useWords';
import { useSettings } from '@/store/useSettings';
import { lookupYoudaoWord, canUseYoudao } from '@/api/youdao';
import { isMarkableToken, normalizeMarkWord } from '@/utils/markWords';
import type { RelatedWord } from '@/types/word';

function lettersKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** 练习页近义词等：一键加入个人词表（有道补全释义，无则用手头 gloss） */
export function useQuickAddRelatedWord() {
  const { message } = App.useApp();
  const words = useUserWords();
  const addWord = useWordsStore((s) => s.addWord);
  const settings = useSettings();
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);

  async function addRelatedToBank(item: RelatedWord) {
    const lemma = normalizeMarkWord(item.word);
    if (!lemma) return;
    if (!isMarkableToken(lemma)) {
      message.info('常见词，不用加入');
      return;
    }
    const key = lettersKey(lemma);
    for (const w of words) {
      if (w.crossedOut) continue;
      if (lettersKey(w.word) === key) {
        message.info(`「${lemma}」已在词表`);
        return;
      }
    }

    setAddingKey(key);
    const hide = message.loading(`正在加入「${lemma}」…`, 0);
    try {
      let translation = String(item.gloss || '').trim();
      let phoneticUs = '';
      let phoneticUk = '';
      let partOfSpeech = '';
      if (canUseYoudao(settings)) {
        try {
          const info = await lookupYoudaoWord(lemma, settings);
          if (info.translation) translation = info.translation;
          if (info.phoneticUs) phoneticUs = info.phoneticUs;
          if (info.phoneticUk) phoneticUk = info.phoneticUk;
          if (info.partOfSpeech) partOfSpeech = info.partOfSpeech;
        } catch {
          /* keep gloss */
        }
      }
      if (!translation) translation = '（待补充释义）';
      await addWord(
        makeNewWord({
          word: lemma,
          translation,
          phoneticUs,
          phoneticUk,
          partOfSpeech,
        })
      );
      setJustAddedKey(key);
      setTimeout(() => setJustAddedKey(null), 600);
      message.success(`已加入词表「${lemma}」`);
    } catch (e) {
      message.error('加入失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      hide();
      setAddingKey(null);
    }
  }

  return { addRelatedToBank, addingKey, justAddedKey };
}
