import { useState } from 'react';
import { Input, Button, App } from 'antd';
import { useSettings } from '@/store/useSettings';
import { useWordsStore, makeNewWord, useUserWords } from '@/store/useWords';
import { areInflectionVariants } from '@/utils/inflections';
import { lookupWordInfo } from '@/api/llm';
import PhoneticDisplay from '@/components/PhoneticDisplay';

export default function AddPage() {
  const { message } = App.useApp();
  const settings = useSettings();
  const addWord = useWordsStore((s) => s.addWord);
  const words = useUserWords();
  const [word, setWord] = useState('');
  const [translation, setTranslation] = useState('');
  const [phonetic, setPhonetic] = useState('');
  const [phoneticUs, setPhoneticUs] = useState('');
  const [phoneticUk, setPhoneticUk] = useState('');
  const [partOfSpeech, setPartOfSpeech] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [generating, setGenerating] = useState(false);

  const hasPreview = !!(translation || phonetic || phoneticUs || phoneticUk);

  function clearAll() {
    setWord('');
    setTranslation('');
    setPhonetic('');
    setPhoneticUs('');
    setPhoneticUk('');
    setPartOfSpeech('');
    setMnemonic('');
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
    setGenerating(true);
    try {
      const info = await lookupWordInfo(word.trim(), settings);
      if (info.translation) setTranslation(info.translation);
      if (info.phoneticUs) setPhoneticUs(info.phoneticUs);
      if (info.phoneticUk) setPhoneticUk(info.phoneticUk);
      if (info.phonetic) setPhonetic(info.phonetic);
      else if (info.phoneticUk) setPhonetic(info.phoneticUk);
      else if (info.phoneticUs) setPhonetic(info.phoneticUs);
      if (info.partOfSpeech) setPartOfSpeech(info.partOfSpeech);
      if (info.mnemonic) setMnemonic(info.mnemonic);
      message.success('已自动填充');
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
    const dup = words.find((w) => areInflectionVariants(w.word, word));
    if (dup) {
      message.warning(`这个词和「${dup.word}」太像了`);
      return;
    }
    const w = makeNewWord({
      word: word.trim(),
      translation: translation.trim(),
      phonetic: phonetic.trim() || phoneticUk.trim() || phoneticUs.trim(),
      phoneticUs: phoneticUs.trim(),
      phoneticUk: phoneticUk.trim(),
      partOfSpeech: partOfSpeech.trim(),
      mnemonic: mnemonic.trim(),
    });
    await addWord(w);
    message.success(`已保存「${w.word}」`);
    clearAll();
  }

  return (
    <div>
      <div className="app-header">
        <h1>添加生词</h1>
        <p>输入单词，AI 自动生成音标与翻译</p>
      </div>

      <div className="app-card">
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-light)', marginBottom: 6, fontWeight: 500 }}>
          单词
        </label>
        <Input
          className="add-word-input"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          onPressEnter={() => word.trim() && handleGenerate()}
          placeholder="例如: abandon"
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

      {hasPreview && (
        <div className="app-card">
          <h3 style={{ marginBottom: 12, fontSize: 14 }}>预览</h3>
          <div className="word-list-item" style={{ margin: 0, border: 'none', padding: 0, background: 'transparent' }}>
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
              <span className="text-light" style={{ fontSize: 12 }}>💡 助记</span>
              <br />
              {mnemonic}
            </div>
          )}
          <div className="flex-row mt-3" style={{ justifyContent: 'space-between' }}>
            <Button size="small" onClick={handleGenerate} loading={generating}>
              🔄 重新生成
            </Button>
            <Button type="primary" onClick={handleSubmit}>
              ✓ 保存到词表
            </Button>
          </div>
        </div>
      )}

      <div className="app-card">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>💡 提示</h3>
        <ul style={{ paddingLeft: 20, color: 'var(--text-light)', fontSize: 13, lineHeight: 1.8, margin: 0 }}>
          <li>一次输入一个词，AI 会生成音标和中文释义</li>
          <li>词表格式：单词 · 音标 · 发音 · 翻译</li>
          <li>保存后这个单词就进入你的学习计划</li>
          <li>如果不再想看到某个词，去词表里「划掉」</li>
        </ul>
      </div>
    </div>
  );
}
