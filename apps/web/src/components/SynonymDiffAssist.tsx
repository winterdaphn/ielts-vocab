import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, App } from 'antd';
import { useSettings } from '@/store/useSettings';
import { explainSynonymDifferences } from '@/api/llm';
import type {
  RelatedWord,
  StoredSynonymDiff,
  SynonymDiffResult,
} from '@/types/word';

interface Options {
  headword: string;
  translation?: string;
  synonyms: RelatedWord[];
  /** Practice / detail sentence — AI judges replaceability in this context */
  sentence?: string;
  /** Compact link-style for practice tip headers */
  compact?: boolean;
  /** Hydrate from local DB (Word.synonymDiff) */
  stored?: StoredSynonymDiff | null;
  /** Persist to local DB only — caller must not sync this field to cloud */
  onSave?: (diff: StoredSynonymDiff) => void | Promise<void>;
}

export function synonymDiffCacheKey(
  head: string,
  syns: RelatedWord[],
  sentence = ''
): string {
  const peers = syns
    .map((s) => String(s.word || '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
  const sent = String(sentence || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return `${head.trim().toLowerCase()}|${peers}|${sent}`;
}

function DiffPanel({ result }: { result: SynonymDiffResult }) {
  const hasReplace = result.items.some((it) => typeof it.replaceOk === 'boolean');
  return (
    <div className="synonym-diff-panel">
      {result.sentence ? (
        <p className="synonym-diff-sentence">
          <span className="synonym-diff-sentence-label">针对句子</span>
          {result.sentence}
        </p>
      ) : null}
      {result.summary ? (
        <p className="synonym-diff-summary">{result.summary}</p>
      ) : null}
      {result.items.length > 0 && (
        <ul className="synonym-diff-items">
          {result.items.map((it) => (
            <li key={it.word}>
              <b className="synonym-diff-word">{it.word}</b>
              {it.focus ? (
                <span className="synonym-diff-focus"> · {it.focus}</span>
              ) : null}
              {it.usage ? (
                <div className="synonym-diff-usage">{it.usage}</div>
              ) : null}
              {typeof it.replaceOk === 'boolean' ? (
                <div
                  className={
                    it.replaceOk
                      ? 'synonym-diff-replace is-ok'
                      : 'synonym-diff-replace is-no'
                  }
                >
                  {it.replaceOk ? '本句可替换' : '本句不宜换'}
                  {it.replaceNote ? ` · ${it.replaceNote}` : ''}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {hasReplace ? (
        <p className="synonym-diff-replace-hint">
          「本句可/不宜」指能否在上面这句里替换中心词，不是泛泛近义。
        </p>
      ) : null}
      {result.contrasts.length > 0 && (
        <ul className="synonym-diff-contrasts">
          {result.contrasts.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Shared logic: title-row trigger + body panel */
export function useSynonymDiffAssist({
  headword,
  translation = '',
  synonyms,
  sentence = '',
  compact = false,
  stored = null,
  onSave,
}: Options): { trigger: ReactNode; panel: ReactNode } {
  const { message } = App.useApp();
  const settings = useSettings();
  const key = useMemo(
    () => synonymDiffCacheKey(headword, synonyms, sentence),
    [headword, synonyms, sentence]
  );

  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SynonymDiffResult | null>(null);
  const [cachedKey, setCachedKey] = useState('');

  // 从本地 DB 恢复；近义/句子变了则视为失效。匹配时不改 open。
  useEffect(() => {
    if (stored?.key === key && (stored.summary || stored.items?.length)) {
      setResult({
        summary: stored.summary || '',
        items: Array.isArray(stored.items) ? stored.items : [],
        contrasts: Array.isArray(stored.contrasts) ? stored.contrasts : [],
        ...(stored.sentence ? { sentence: stored.sentence } : {}),
      });
      setCachedKey(key);
      return;
    }
    setOpen(false);
    setResult(null);
    setCachedKey('');
  }, [key, stored?.key]);

  const usable = synonyms.filter((s) => {
    const w = String(s.word || '').trim().toLowerCase();
    return w && w !== headword.trim().toLowerCase();
  });

  async function run() {
    if (!usable.length) {
      message.warning('请先有近义词再辨析');
      return;
    }
    if (result && cachedKey === key) {
      setOpen((v) => !v);
      return;
    }
    if (!settings.apiKey) {
      message.warning('请先在设置里填 API Key');
      return;
    }
    setBusy(true);
    try {
      const next = await explainSynonymDifferences(
        headword,
        translation,
        usable,
        settings,
        { sentence }
      );
      if (!next.summary && !next.items.length && !next.contrasts.length) {
        message.warning('未生成辨析，请重试');
        return;
      }
      setResult(next);
      setCachedKey(key);
      setOpen(true);
      const payload: StoredSynonymDiff = { key, ...next };
      try {
        await onSave?.(payload);
      } catch {
        /* 展示仍可用；落库失败不打断 */
      }
    } catch (e) {
      message.error(
        'AI 辨析失败：' + (e instanceof Error ? e.message : '未知错误')
      );
    } finally {
      setBusy(false);
    }
  }

  const hasCache = !!(result && cachedKey === key);
  const label = busy
    ? '辨析中…'
    : hasCache && open
      ? '收起辨析'
      : hasCache
        ? '查看辨析'
        : 'AI 辨析';

  const trigger = (
    <Button
      size="small"
      type={compact ? 'link' : 'default'}
      loading={busy}
      onClick={run}
      style={
        compact ? { padding: '0 4px', height: 'auto', fontSize: 12 } : undefined
      }
      disabled={!usable.length && !busy}
    >
      {label}
    </Button>
  );

  const panel = open && result ? <DiffPanel result={result} /> : null;

  return { trigger, panel };
}

/** Self-contained: trigger then panel (stack vertically) */
export default function SynonymDiffAssist(props: Options) {
  const { trigger, panel } = useSynonymDiffAssist(props);
  return (
    <div className="synonym-diff-assist">
      {trigger}
      {panel}
    </div>
  );
}
