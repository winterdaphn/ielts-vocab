import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Button, Card, Input, Segmented, Select, App } from 'antd';
import { useSearchParams } from 'react-router-dom';
import AddWordPanel from '@/components/AddWordPanel';
import { useSettings } from '@/store/useSettings';
import { generateChunkExplanation } from '@/api/llm';
import { lookupYoudaoPhrase, YoudaoError, canUseYoudao } from '@/api/youdao';
import ChunkExplanationView from '@/components/ChunkExplanationView';
import { formatYoudaoExplanation } from '@/utils/chunkExplanation';
import { useChunksStore } from '@/store/useChunks';
import { useFramesStore, FRAME_PACK } from '@/store/useFrames';
import { normalizePhraseKey } from '@/types/chunk';
import { normalizeFrameKey } from '@/types/frame';

type ContentKind = 'word' | 'chunk' | 'frame';
type FrameMode = 'pack' | 'manual';

const fieldLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-light)',
  marginBottom: 6,
  fontWeight: 500,
};

const hintListStyle: CSSProperties = {
  paddingLeft: 20,
  color: 'var(--text-light)',
  fontSize: 13,
  lineHeight: 1.8,
  margin: 0,
};

function parseContentKind(raw: string | null): ContentKind | null {
  if (raw === 'word' || raw === 'chunk' || raw === 'frame') return raw;
  return null;
}

/** 设置 · 数据：统一添加单词 / 语块 / 模板 */
export default function AddContentPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = parseContentKind(searchParams.get('add'));
  const [kind, setKind] = useState<ContentKind>(fromUrl ?? 'word');

  useEffect(() => {
    if (fromUrl) setKind(fromUrl);
  }, [fromUrl]);

  function onKindChange(next: ContentKind) {
    setKind(next);
    const tab = searchParams.get('tab') || 'data';
    setSearchParams({ tab, add: next }, { replace: true });
  }

  return (
    <>
      <Card title="添加内容" style={{ marginBottom: 12 }}>
        <p className="text-light" style={{ fontSize: 13, margin: '0 0 12px' }}>
          选择要添加的类型，填写后可在预览中确认再保存
        </p>
        <Segmented
          block
          value={kind}
          onChange={(v) => onKindChange(v as ContentKind)}
          options={[
            { label: '单词', value: 'word' },
            { label: '语块', value: 'chunk' },
            { label: '模板', value: 'frame' },
          ]}
        />
      </Card>

      {kind === 'word' && <AddWordPanel />}
      {kind === 'chunk' && <AddChunkPanel />}
      {kind === 'frame' && <AddFramePanel />}
    </>
  );
}

function AddChunkPanel() {
  const { message } = App.useApp();
  const settings = useSettings();
  const addFromCollocation = useChunksStore((s) => s.addFromCollocation);
  const findByPhraseKey = useChunksStore((s) => s.findByPhraseKey);

  const [phrase, setPhrase] = useState('');
  const [gloss, setGloss] = useState('');
  const [exampleEn, setExampleEn] = useState('');
  const [exampleZh, setExampleZh] = useState('');
  const [explanation, setExplanation] = useState('');
  const [alreadyExists, setAlreadyExists] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const canLookup = canUseYoudao(settings);
  const canAi = !!settings.apiKey;
  const canGenerate = canLookup || canAi;
  const generateLabel = canAi
    ? canLookup
      ? '有道 + AI 解释'
      : 'AI 解释'
    : canLookup
      ? '有道查释义'
      : '无法填充';

  const hasPreview = !!phrase.trim();

  useEffect(() => {
    let cancelled = false;
    const key = normalizePhraseKey(phrase);
    if (!key) {
      setAlreadyExists(null);
      return;
    }
    void findByPhraseKey(key).then((c) => {
      if (!cancelled) setAlreadyExists(!!c);
    });
    return () => {
      cancelled = true;
    };
  }, [phrase, findByPhraseKey]);

  function clearAll() {
    setPhrase('');
    setGloss('');
    setExampleEn('');
    setExampleZh('');
    setExplanation('');
    setAlreadyExists(null);
  }

  async function handleGenerate() {
    if (!phrase.trim()) {
      message.warning('请先输入英文搭配');
      return;
    }
    if (!canGenerate) {
      message.error('需要有道代理（登录同源 /api）或配置 AI API Key');
      return;
    }
    setGenerating(true);
    try {
      let glossHint = gloss.trim();
      let fromYoudao = false;

      if (canLookup) {
        try {
          const yd = await lookupYoudaoPhrase(phrase.trim(), settings);
          if (yd.gloss) {
            glossHint = yd.gloss;
            setGloss(yd.gloss);
            fromYoudao = true;
          }
        } catch {
          /* 有道无结果时继续走 AI */
        }
      }

      if (canAi) {
        const details = await generateChunkExplanation(phrase.trim(), settings, {
          hintGloss: glossHint,
        });
        if (details) {
          setGloss(details.gloss);
          setExampleEn(details.exampleEn);
          setExampleZh(details.exampleZh);
          setExplanation(details.explanation);
          message.success(fromYoudao ? '已用有道 + AI 生成讲解' : '已用 AI 生成讲解');
          return;
        }
        if (!fromYoudao && !glossHint) {
          message.warning('AI 未返回有效内容，请手动填写');
          return;
        }
      }

      if (fromYoudao && glossHint) {
        setExplanation(formatYoudaoExplanation(phrase.trim(), glossHint));
        message.success(canAi ? '有道已有释义，AI 生成失败' : '已用有道填充释义');
      } else {
        message.warning('未查到内容，请手动填写');
      }
    } catch (e) {
      const msg =
        e instanceof YoudaoError
          ? e.message
          : e instanceof Error
            ? e.message
            : '未知错误';
      message.error('生成失败：' + msg);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit() {
    if (!phrase.trim()) {
      message.warning('请填写英文搭配');
      return;
    }
    setSaving(true);
    try {
      const { existed } = await addFromCollocation({
        phrase: phrase.trim(),
        gloss: gloss.trim(),
        source: 'manual',
        exampleEn: exampleEn.trim(),
        exampleZh: exampleZh.trim(),
        explanation: explanation.trim(),
      });
      message.success(existed ? '已在搭配本' : '已加入搭配本');
      if (!existed) clearAll();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="app-card" style={{ marginBottom: 12 }}>
        <label style={fieldLabelStyle}>英文搭配</label>
        <Input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          onPressEnter={() => phrase.trim() && canGenerate && void handleGenerate()}
          placeholder="例如: take into account / play a role in"
          size="large"
          style={{ fontFamily: 'Georgia, serif' }}
        />
        <div className="flex-row mt-2" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={clearAll}>清空</Button>
          <Button
            type="primary"
            loading={generating}
            disabled={!canGenerate}
            onClick={() => void handleGenerate()}
          >
            {generateLabel}
          </Button>
        </div>
        {(explanation.trim() || gloss.trim() || hasPreview) && (
          <>
            <label style={{ ...fieldLabelStyle, marginTop: 12 }}>AI 讲解（可编辑）</label>
            <Input.TextArea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="点上方按钮生成，或直接粘贴/编辑 Markdown 风格讲解"
              autoSize={{ minRows: 6, maxRows: 16 }}
            />
          </>
        )}
      </div>

      {hasPreview && (
        <div className="app-card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginBottom: 12, fontSize: 14 }}>预览</h3>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, marginBottom: 12 }}>
            {phrase.trim()}
          </div>
          {explanation.trim() ? (
            <ChunkExplanationView text={explanation} />
          ) : gloss.trim() ? (
            <div style={{ fontSize: 14 }}>{gloss.trim()}</div>
          ) : (
            <div className="text-light" style={{ fontSize: 13 }}>
              点「{generateLabel}」生成讲解，或直接保存短语
            </div>
          )}
          {alreadyExists && (
            <p className="text-light" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              搭配本里已有相同语块，保存不会重复添加
            </p>
          )}
          <div className="flex-row mt-3" style={{ justifyContent: 'flex-end' }}>
            <Button type="primary" loading={saving} onClick={() => void handleSubmit()}>
              {alreadyExists ? '已在搭配本' : '保存到搭配本'}
            </Button>
          </div>
        </div>
      )}

      <div className="app-card" style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>提示</h3>
        <ul style={hintListStyle}>
          <li>输入搭配后点「AI 解释」，会生成核心释义、发音、语法、例句等完整讲解</li>
          <li>讲解以 Markdown 保存，详情页直接展示；列表仍用短释义</li>
          <li>也可在词详情页的词典搭配旁点「加入搭配本」</li>
          <li>相同英文搭配（忽略大小写与空格）只会保留一条</li>
        </ul>
      </div>
    </>
  );
}

function AddFramePanel() {
  const { message } = App.useApp();
  const addFromPack = useFramesStore((s) => s.addFromPack);
  const addManual = useFramesStore((s) => s.addManual);
  const findByFrameKey = useFramesStore((s) => s.findByFrameKey);

  const [mode, setMode] = useState<FrameMode>('pack');
  const [packTitle, setPackTitle] = useState<string | null>(FRAME_PACK[0]?.title ?? null);
  const [title, setTitle] = useState('');
  const [skeleton, setSkeleton] = useState('');
  const [glossZh, setGlossZh] = useState('');
  const [exampleFilled, setExampleFilled] = useState('');
  const [alreadyExists, setAlreadyExists] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const packItem = useMemo(
    () => FRAME_PACK.find((x) => x.title === packTitle) ?? null,
    [packTitle]
  );

  const previewSkeleton = mode === 'pack' ? packItem?.skeleton ?? '' : skeleton.trim();
  const previewTitle = mode === 'pack' ? packItem?.title ?? '' : title.trim() || skeleton.trim().slice(0, 48);
  const previewGloss = mode === 'pack' ? packItem?.glossZh ?? '' : glossZh.trim();
  const previewExample =
    mode === 'pack' ? packItem?.exampleFilled ?? '' : exampleFilled.trim();
  const previewSlots = mode === 'pack' ? packItem?.slots ?? [] : [];

  const hasPreview =
    mode === 'pack' ? !!packItem : !!skeleton.trim();

  useEffect(() => {
    let cancelled = false;
    const sk = previewSkeleton;
    if (!sk) {
      setAlreadyExists(null);
      return;
    }
    void findByFrameKey(normalizeFrameKey(sk)).then((f) => {
      if (!cancelled) setAlreadyExists(!!f);
    });
    return () => {
      cancelled = true;
    };
  }, [previewSkeleton, findByFrameKey]);

  function clearManual() {
    setTitle('');
    setSkeleton('');
    setGlossZh('');
    setExampleFilled('');
  }

  async function handleSubmit() {
    setSaving(true);
    try {
      if (mode === 'pack') {
        if (!packItem) {
          message.warning('请选择预制模板');
          return;
        }
        const { existed } = await addFromPack(packItem);
        message.success(existed ? '已在模板本' : '已加入模板本');
      } else {
        if (!skeleton.trim()) {
          message.warning('请填写句式骨架');
          return;
        }
        const { existed } = await addManual({
          title: title.trim(),
          skeleton: skeleton.trim(),
          glossZh: glossZh.trim(),
          exampleFilled: exampleFilled.trim(),
        });
        message.success(existed ? '已在模板本' : '已加入模板本');
        if (!existed) clearManual();
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="app-card" style={{ marginBottom: 12 }}>
        <Segmented
          block
          value={mode}
          onChange={(v) => setMode(v as FrameMode)}
          options={[
            { label: '预制包', value: 'pack' },
            { label: '自定义', value: 'manual' },
          ]}
          style={{ marginBottom: 12 }}
        />

        {mode === 'pack' ? (
          <>
            <label style={fieldLabelStyle}>选择模板</label>
            <Select
              showSearch
              optionFilterProp="label"
              style={{ width: '100%' }}
              value={packTitle}
              onChange={setPackTitle}
              options={FRAME_PACK.map((item) => ({
                value: item.title,
                label: item.title,
              }))}
            />
          </>
        ) : (
          <>
            <label style={fieldLabelStyle}>标题（可选）</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="列表里显示的短标题"
            />
            <label style={{ ...fieldLabelStyle, marginTop: 12 }}>句式骨架</label>
            <Input.TextArea
              value={skeleton}
              onChange={(e) => setSkeleton(e.target.value)}
              placeholder="例如: There is growing concern that [clause]."
              autoSize={{ minRows: 2, maxRows: 4 }}
              style={{ fontFamily: 'Georgia, serif' }}
            />
            <label style={{ ...fieldLabelStyle, marginTop: 12 }}>中文说明</label>
            <Input
              value={glossZh}
              onChange={(e) => setGlossZh(e.target.value)}
              placeholder="用法或场景说明"
            />
            <label style={{ ...fieldLabelStyle, marginTop: 12 }}>填好后的例句（可选）</label>
            <Input.TextArea
              value={exampleFilled}
              onChange={(e) => setExampleFilled(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
            <div className="flex-row mt-2" style={{ justifyContent: 'flex-end' }}>
              <Button onClick={clearManual}>清空</Button>
            </div>
          </>
        )}
      </div>

      {hasPreview && (
        <div className="app-card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginBottom: 12, fontSize: 14 }}>预览</h3>
          {previewTitle && (
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{previewTitle}</div>
          )}
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 16, lineHeight: 1.5 }}>
            {previewSkeleton}
          </div>
          {previewSlots.length > 0 && (
            <ul className="text-light" style={{ fontSize: 12, margin: '10px 0 0', paddingLeft: 18 }}>
              {previewSlots.map((s) => (
                <li key={s.key}>
                  [{s.key}] {s.hintZh}
                </li>
              ))}
            </ul>
          )}
          {previewGloss && (
            <div className="mt-2" style={{ fontSize: 13 }}>
              {previewGloss}
            </div>
          )}
          {previewExample && (
            <div className="mt-2" style={{ fontSize: 13, lineHeight: 1.55 }}>
              <span className="text-light" style={{ fontSize: 12 }}>
                示例
              </span>
              <br />
              {previewExample}
            </div>
          )}
          {alreadyExists && (
            <p className="text-light" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              模板本里已有相同骨架，保存不会重复添加
            </p>
          )}
          <div className="flex-row mt-3" style={{ justifyContent: 'flex-end' }}>
            <Button type="primary" loading={saving} onClick={() => void handleSubmit()}>
              {alreadyExists ? '已在模板本' : '保存到模板本'}
            </Button>
          </div>
        </div>
      )}

      <div className="app-card" style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>提示</h3>
        <ul style={hintListStyle}>
          <li>预制包适合雅思写作/口语常见句型；自定义可录自己的骨架</li>
          <li>搭配 Tab 里仍可浏览已收藏模板与预制包快捷加入</li>
        </ul>
      </div>
    </>
  );
}
