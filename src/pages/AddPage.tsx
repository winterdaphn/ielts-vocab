import { useState } from 'react';
import { Input, Button, App, Alert } from 'antd';
import { useSettings } from '@/store/useSettings';
import { useWordsStore, makeNewWord, useUserWords } from '@/store/useWords';
import { areInflectionVariants, resolveLemma } from '@/utils/inflections';
import { lookupWordInfo } from '@/api/llm';
import RelatedWordsList from '@/components/RelatedWordsList';
import PhoneticDisplay from '@/components/PhoneticDisplay';
import type { RelatedWord } from '@/types/word';

export default function AddPage() {
  const { message } = App.useApp();
  const settings = useSettings();
  const addWord = useWordsStore((s) => s.addWord);
  const words = useUserWords();
  const [word, setWord] = useState('');
  const [inputRaw, setInputRaw] = useState('');
  const [formNote, setFormNote] = useState('');
  const [translation, setTranslation] = useState('');
  const [phonetic, setPhonetic] = useState('');
  const [phoneticUs, setPhoneticUs] = useState('');
  const [phoneticUk, setPhoneticUk] = useState('');
  const [partOfSpeech, setPartOfSpeech] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [synonyms, setSynonyms] = useState<RelatedWord[]>([]);
  const [similars, setSimilars] = useState<RelatedWord[]>([]);
  const [generating, setGenerating] = useState(false);

  const hasPreview = !!(translation || phonetic || phoneticUs || phoneticUk);
  const showedLemmaHint =
    !!inputRaw && !!word && inputRaw.toLowerCase() !== word.toLowerCase();

  function clearAll() {
    setWord('');
    setInputRaw('');
    setFormNote('');
    setTranslation('');
    setPhonetic('');
    setPhoneticUs('');
    setPhoneticUk('');
    setPartOfSpeech('');
    setMnemonic('');
    setSynonyms([]);
    setSimilars([]);
  }

  async function handleGenerate() {
    if (!word.trim()) {
      message.warning('请先输入单词');
      return;
    }
    if (!settings.apiKey) {
      message.error('请先在设置里填 API Key');
      return;
    }
    const typed = word.trim();
    setGenerating(true);
    try {
      const info = await lookupWordInfo(typed, settings);
      const lemma = resolveLemma(typed, info.lemma);
      setInputRaw(typed);
      setWord(lemma);
      setFormNote(info.formNote || (lemma !== typed.toLowerCase() ? '词形变化' : ''));
      if (info.translation) setTranslation(info.translation);
      if (info.phoneticUs) setPhoneticUs(info.phoneticUs);
      if (info.phoneticUk) setPhoneticUk(info.phoneticUk);
      if (info.phonetic) setPhonetic(info.phonetic);
      else if (info.phoneticUk) setPhonetic(info.phoneticUk);
      else if (info.phoneticUs) setPhonetic(info.phoneticUs);
      if (info.partOfSpeech) setPartOfSpeech(info.partOfSpeech);
      if (info.mnemonic) setMnemonic(info.mnemonic);
      setSynonyms(info.synonyms || []);
      setSimilars(info.similars || []);
      if (lemma !== typed.toLowerCase()) {
        message.success(`已还原为原形「${lemma}」`);
      } else {
        message.success('已自动填充');
      }
    } catch (e) {
      message.error('查询失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit() {
    if (!word.trim() || !translation.trim()) {
      message.warning('单词和释义必填');
      return;
    }
    const saveAs = resolveLemma(word.trim());
    const dup = words.find((w) => areInflectionVariants(w.word, saveAs));
    if (dup) {
      message.warning(`这个词和「${dup.word}」太像了（词形变化）`);
      return;
    }
    const w = makeNewWord({
      word: saveAs,
      translation: translation.trim(),
      phonetic: phonetic.trim() || phoneticUk.trim() || phoneticUs.trim(),
      phoneticUs: phoneticUs.trim(),
      phoneticUk: phoneticUk.trim(),
      partOfSpeech: partOfSpeech.trim(),
      mnemonic: mnemonic.trim(),
      synonyms,
      similars,
    });
    await addWord(w);
    message.success(`已保存「${w.word}」`);
    clearAll();
  }

  return (
    <div>
      <div className="app-header">
        <h1>添加生词</h1>
        <p>输入单词，AI 自动还原原形并生成音标、翻译与近义/形近</p>
      </div>

      <div className="app-card">
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-light)', marginBottom: 6, fontWeight: 500 }}>
          单词
        </label>
        <Input
          className="add-word-input"
          value={word}
          onChange={(e) => {
            setWord(e.target.value);
            setFormNote('');
            setInputRaw('');
            setSynonyms([]);
            setSimilars([]);
          }}
          onPressEnter={() => word.trim() && handleGenerate()}
          placeholder="例如: abandon / ingredients / possesses"
          autoComplete="off"
          spellCheck={false}
          size="large"
          style={{
            fontSize: 18,
            fontFamily: 'Georgia, serif',
            textAlign: 'center',
            padding: '14px 16px',
          }}
        />
        <div className="flex-row mt-2" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={clearAll}>清空</Button>
          <Button
            type="primary"
            onClick={handleGenerate}
            loading={generating}
            disabled={!settings.apiKey}
          >
            {settings.apiKey ? '🤖 AI 查词' : '先配置 API Key'}
          </Button>
        </div>
      </div>

      {showedLemmaHint && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            formNote
              ? `「${inputRaw}」是「${word}」的${formNote}，已改为收录原形`
              : `已将「${inputRaw}」还原为原形「${word}」`
          }
        />
      )}

      {hasPreview && (
        <div className="app-card">
          <h3 style={{ marginBottom: 12, fontSize: 14 }}>预览</h3>
          <div className="word-list-item" style={{ margin: 0, border: 'none', padding: 0, background: 'transparent', cursor: 'default' }}>
            <div className="word-main">
              <div className="word-row">
                <span className="word">{word}</span>
                <PhoneticDisplay
                  word={{ word, phonetic, phoneticUs, phoneticUk }}
                  withSpeak
                />
              </div>
              <span className="translation">{translation}</span>
            </div>
          </div>
          {partOfSpeech && (
            <div className="text-light mt-2" style={{ fontSize: 12 }}>词性：{partOfSpeech}</div>
          )}
          {mnemonic && (
            <div className="mt-2" style={{ fontSize: 13, lineHeight: 1.55 }}>
              <span className="text-light" style={{ fontSize: 12 }}>助记</span>
              <br />
              {mnemonic}
            </div>
          )}
          {synonyms.length > 0 && (
            <div className="mt-2">
              <div className="text-light" style={{ fontSize: 12, marginBottom: 4 }}>近义词</div>
              <RelatedWordsList items={synonyms} />
            </div>
          )}
          {similars.length > 0 && (
            <div className="mt-2">
              <div className="text-light" style={{ fontSize: 12, marginBottom: 4 }}>形近词</div>
              <RelatedWordsList items={similars} />
            </div>
          )}
          <div className="flex-row mt-3" style={{ justifyContent: 'space-between' }}>
            <Button size="small" onClick={handleGenerate} loading={generating}>
              重新生成
            </Button>
            <Button type="primary" onClick={handleSubmit}>
              保存到词表
            </Button>
          </div>
        </div>
      )}

      <div className="app-card">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>提示</h3>
        <ul style={{ paddingLeft: 20, color: 'var(--text-light)', fontSize: 13, lineHeight: 1.8, margin: 0 }}>
          <li>可输入复数 / -ing / -ed 等变形，AI 会还原成原形再收录</li>
          <li>查词时会顺带生成近义词与形近词（仅拼写相近），便于辨析</li>
          <li>词表里点词条可看完整详情</li>
        </ul>
      </div>
    </div>
  );
}
