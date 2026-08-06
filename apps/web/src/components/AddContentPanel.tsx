import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Button, Card, Input, Segmented, Select, App } from 'antd';
import { useSearchParams } from 'react-router-dom';
import AddWordPanel from '@/components/AddWordPanel';
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
  const addFromCollocation = useChunksStore((s) => s.addFromCollocation);
  const findByPhraseKey = useChunksStore((s) => s.findByPhraseKey);

  const [phrase, setPhrase] = useState('');
  const [gloss, setGloss] = useState('');
  const [exampleEn, setExampleEn] = useState('');
  const [exampleZh, setExampleZh] = useState('');
  const [alreadyExists, setAlreadyExists] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

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
    setAlreadyExists(null);
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
          placeholder="例如: take into account / play a role in"
          size="large"
          style={{ fontFamily: 'Georgia, serif' }}
        />
        <label style={{ ...fieldLabelStyle, marginTop: 12 }}>中文释义（可选）</label>
        <Input
          value={gloss}
          onChange={(e) => setGloss(e.target.value)}
          placeholder="简要中文意思"
        />
        <label style={{ ...fieldLabelStyle, marginTop: 12 }}>例句（可选）</label>
        <Input.TextArea
          value={exampleEn}
          onChange={(e) => setExampleEn(e.target.value)}
          placeholder="英文例句"
          autoSize={{ minRows: 2, maxRows: 4 }}
        />
        <Input.TextArea
          className="mt-2"
          value={exampleZh}
          onChange={(e) => setExampleZh(e.target.value)}
          placeholder="例句中文（可选）"
          autoSize={{ minRows: 2, maxRows: 4 }}
        />
        <div className="flex-row mt-2" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={clearAll}>清空</Button>
        </div>
      </div>

      {hasPreview && (
        <div className="app-card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginBottom: 12, fontSize: 14 }}>预览</h3>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, marginBottom: 8 }}>
            {phrase.trim()}
          </div>
          {gloss.trim() ? (
            <div style={{ fontSize: 14, color: 'var(--text)' }}>{gloss.trim()}</div>
          ) : (
            <div className="text-light" style={{ fontSize: 13 }}>
              未填释义
            </div>
          )}
          {exampleEn.trim() && (
            <div className="mt-2" style={{ fontSize: 13, lineHeight: 1.55 }}>
              <span className="text-light" style={{ fontSize: 12 }}>
                例句
              </span>
              <br />
              {exampleEn.trim()}
              {exampleZh.trim() ? (
                <>
                  <br />
                  <span className="text-light">{exampleZh.trim()}</span>
                </>
              ) : null}
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
