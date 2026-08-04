import { useState } from 'react';
import { Input, Button, App, Alert } from 'antd';
import { useSettings } from '@/store/useSettings';
import { useWordsStore, makeNewWord, useUserWords } from '@/store/useWords';
import { useCategories } from '@/store/useCategories';
import { areInflectionVariants, resolveLemma, isPlausibleLemmaReduction } from '@/utils/inflections';
import { resolveLemmaWithAI, suggestCategoriesWithAI, generateRelatedWords } from '@/api/llm';
import { lookupYoudaoWord, YoudaoError, canUseYoudao } from '@/api/youdao';
import { mergeSynonymSources } from '@/utils/vocabBankRelated';
import RelatedWordsList from '@/components/RelatedWordsList';
import DerivativesList from '@/components/DerivativesList';
import CollocationsList from '@/components/CollocationsList';
import PhoneticDisplay from '@/components/PhoneticDisplay';
import WordCategoryEditor from '@/components/WordCategoryEditor';
import type { Collocation, Derivative, RelatedWord } from '@/types/word';
import CategoryManager from '@/components/CategoryManager';
import { normalizeCategories } from '@/config/categories';

export default function AddPage() {
  const { message } = App.useApp();
  const settings = useSettings();
  const addWord = useWordsStore((s) => s.addWord);
  const words = useUserWords();
  const allCategories = useCategories((s) => s.all);
  const [word, setWord] = useState('');
  const [inputRaw, setInputRaw] = useState('');
  const [formNote, setFormNote] = useState('');
  const [translation, setTranslation] = useState('');
  const [phoneticUs, setPhoneticUs] = useState('');
  const [phoneticUk, setPhoneticUk] = useState('');
  const [partOfSpeech, setPartOfSpeech] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [category, setCategory] = useState<string[]>([]);
  const [synonyms, setSynonyms] = useState<RelatedWord[]>([]);
  const [similars, setSimilars] = useState<RelatedWord[]>([]);
  const [derivatives, setDerivatives] = useState<Derivative[]>([]);
  const [dictCollocations, setDictCollocations] = useState<Collocation[]>([]);
  const [generating, setGenerating] = useState(false);

  const hasPreview = !!(translation || phoneticUs || phoneticUk);
  const showedLemmaHint =
    !!inputRaw &&
    !!word &&
    inputRaw.toLowerCase() !== word.toLowerCase() &&
    isPlausibleLemmaReduction(inputRaw, word);
  const canLookup = canUseYoudao(settings);

  function clearAll() {
    setWord('');
    setInputRaw('');
    setFormNote('');
    setTranslation('');
    setPhoneticUs('');
    setPhoneticUk('');
    setPartOfSpeech('');
    setMnemonic('');
    setCategory([]);
    setSynonyms([]);
    setSimilars([]);
    setDerivatives([]);
    setDictCollocations([]);
  }

  async function handleGenerate() {
    if (!word.trim()) {
      message.warning('请先输入单词');
      return;
    }
    if (!canLookup) {
      message.error('查词需要配置 API Base（设置 → 云同步），或本地开发走代理');
      return;
    }
    const typed = word.trim();
    setGenerating(true);
    try {
      // 1) AI 先还原原形（无 Key 则本地规则）
      let lemma = resolveLemma(typed);
      let formNote = '';
      try {
        const ai = await resolveLemmaWithAI(typed, settings);
        lemma = ai.lemma || lemma;
        formNote = ai.formNote || '';
        if (!isPlausibleLemmaReduction(typed, lemma)) {
          lemma = resolveLemma(typed);
          formNote = '';
        }
      } catch {
        /* keep local lemma */
      }

      // 2) 有道查释义（用用户输入查，避免误还原后查错词）
      const info = await lookupYoudaoWord(typed, settings);
      lemma = resolveLemma(typed, info.lemma);
      const gloss = info.translation || '';
      setInputRaw(typed);
      setWord(lemma);
      setFormNote(
        formNote ||
          info.formNote ||
          (lemma !== typed.toLowerCase() &&
          isPlausibleLemmaReduction(typed, lemma)
            ? '词形变化'
            : '')
      );
      if (gloss) setTranslation(gloss);
      if (info.phoneticUs) setPhoneticUs(info.phoneticUs);
      if (info.phoneticUk) setPhoneticUk(info.phoneticUk);
      if (info.partOfSpeech) setPartOfSpeech(info.partOfSpeech);
      setSynonyms(info.synonyms || []);
      setSimilars([]);
      setDerivatives(info.derivatives || []);
      setDictCollocations(info.dictCollocations || []);

      // 3) AI 近义 + 选题
      let syn = info.synonyms || [];
      let cats: string[] = [];
      if (settings.apiKey) {
        try {
          const fromAi = await generateRelatedWords(lemma, gloss, settings);
          syn = mergeSynonymSources([info.synonyms || [], fromAi.synonyms || []], 10);
          setSynonyms(syn);
        } catch {
          /* keep youdao syn */
        }
        try {
          cats = await suggestCategoriesWithAI(
            lemma,
            gloss,
            settings,
            allCategories()
          );
        } catch {
          cats = [];
        }
      }
      setCategory(normalizeCategories(cats));

      if (lemma !== typed.toLowerCase()) {
        message.success(
          `已还原「${lemma}」· 有道+AI 近义 · ${cats.length ? '已选题' : '未选题'}`
        );
      } else {
        message.success(
          cats.length ? '已用有道+AI 填充并选题' : '已用有道+AI 填充'
        );
      }
    } catch (e) {
      const msg =
        e instanceof YoudaoError
          ? e.message
          : e instanceof Error
            ? e.message
            : '未知错误';
      message.error('查词失败：' + msg);
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
      phoneticUs: phoneticUs.trim(),
      phoneticUk: phoneticUk.trim(),
      partOfSpeech: partOfSpeech.trim(),
      mnemonic: mnemonic.trim(),
      category,
      synonyms,
      similars,
      derivatives,
      dictCollocations,
    });
    await addWord(w);
    message.success(`已保存「${w.word}」`);
    clearAll();
  }

  return (
    <div>
      <div className="app-header">
        <h1>添加生词</h1>
        <p>AI 还原原形并选题；有道释义；近义有道+AI</p>
      </div>

      <div className="app-card">
        <label
          style={{
            display: 'block',
            fontSize: 12,
            color: 'var(--text-light)',
            marginBottom: 6,
            fontWeight: 500,
          }}
        >
          单词
        </label>
        <Input
          className="add-word-input"
          value={word}
          onChange={(e) => {
            setWord(e.target.value);
            setFormNote('');
            setInputRaw('');
            setCategory([]);
            setSynonyms([]);
            setSimilars([]);
            setDerivatives([]);
            setDictCollocations([]);
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
            disabled={!canLookup}
          >
            {canLookup ? '有道查词' : '先配置 API Base'}
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
          <div
            className="word-list-item"
            style={{
              margin: 0,
              border: 'none',
              padding: 0,
              background: 'transparent',
              cursor: 'default',
            }}
          >
            <div className="word-main">
              <div className="word-row">
                <span className="word">{word}</span>
                <PhoneticDisplay
                  word={{ word, phoneticUs, phoneticUk }}
                  withSpeak
                />
              </div>
              <span className="translation">{translation}</span>
            </div>
          </div>
          {partOfSpeech && (
            <div className="text-light mt-2" style={{ fontSize: 12 }}>
              词性：{partOfSpeech}
            </div>
          )}
          <div className="mt-2">
            <div className="text-light" style={{ fontSize: 12, marginBottom: 6 }}>
              分组（AI 建议，可改）
            </div>
            <WordCategoryEditor value={category} onChange={setCategory} />
          </div>
          {mnemonic && (
            <div className="mt-2" style={{ fontSize: 13, lineHeight: 1.55 }}>
              <span className="text-light" style={{ fontSize: 12 }}>
                助记
              </span>
              <br />
              {mnemonic}
            </div>
          )}
          {synonyms.length > 0 && (
            <div className="mt-2">
              <div className="text-light" style={{ fontSize: 12, marginBottom: 4 }}>
                近义词
              </div>
              <RelatedWordsList items={synonyms} />
            </div>
          )}
          {derivatives.length > 0 && (
            <div className="mt-2">
              <div className="text-light" style={{ fontSize: 12, marginBottom: 4 }}>
                派生词
              </div>
              <DerivativesList items={derivatives} />
            </div>
          )}
          {dictCollocations.length > 0 && (
            <div className="mt-2">
              <div className="text-light" style={{ fontSize: 12, marginBottom: 4 }}>
                词典搭配
              </div>
              <CollocationsList items={dictCollocations} />
            </div>
          )}
          <div className="flex-row mt-3" style={{ justifyContent: 'space-between' }}>
            <Button size="small" onClick={handleGenerate} loading={generating}>
              重新查询
            </Button>
            <Button type="primary" onClick={handleSubmit}>
              保存到词表
            </Button>
          </div>
        </div>
      )}

      <CategoryManager />

      <div className="app-card">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>提示</h3>
        <ul
          style={{
            paddingLeft: 20,
            color: 'var(--text-light)',
            fontSize: 13,
            lineHeight: 1.8,
            margin: 0,
          }}
        >
          <li>先由 AI 还原原形并选题（需 API Key），有道查释义；近义为有道+AI 合并</li>
          <li>近义词旁会标注来源（有道 / AI）；释义、搭配、派生仍来自有道</li>
          <li>预览里可改 AI 选的分组后再保存</li>
          <li>线上环境需 Worker 提供 /api/youdao 代理（有道无 CORS）</li>
        </ul>
      </div>
    </div>
  );
}
