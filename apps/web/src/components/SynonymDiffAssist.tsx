import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, App } from 'antd';
import { useSettings } from '@/store/useSettings';
import {
  explainSynonymDifferences,
  judgeSynonymReplaceInSentence,
} from '@/api/llm';
import type {
  RelatedWord,
  StoredSynonymDiff,
  SynonymDiffResult,
} from '@/types/word';
import {
  baseResultFromStored,
  mergeReplaceIntoBase,
  storedSynonymDiffMatchesBase,
  synonymDiffBaseKey,
  synonymDiffReplaceKey,
  toPersistedSynonymDiff,
} from '@/utils/synonymDiffStorage';

interface Options {
  headword: string;
  translation?: string;
  synonyms: RelatedWord[];
  /** 有句子时单独请求「本句能否替换」，不落库、不上云 */
  sentence?: string;
  /** Compact link-style for practice tip headers */
  compact?: boolean;
  stored?: StoredSynonymDiff | null;
  onSave?: (diff: StoredSynonymDiff) => void | Promise<void>;
}

/** @deprecated 使用 synonymDiffBaseKey / synonymDiffReplaceKey */
export function synonymDiffCacheKey(
  head: string,
  syns: RelatedWord[],
  sentence = ''
): string {
  return sentence
    ? synonymDiffReplaceKey(head, syns, sentence)
    : synonymDiffBaseKey(head, syns);
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
    </div>
  );
}

function hasReplaceJudgment(result: SynonymDiffResult | null): boolean {
  return !!result?.items.some((it) => typeof it.replaceOk === 'boolean');
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
  const baseKey = useMemo(
    () => synonymDiffBaseKey(headword, synonyms),
    [headword, synonyms]
  );
  const replaceKey = useMemo(
    () => (sentence ? synonymDiffReplaceKey(headword, synonyms, sentence) : ''),
    [headword, synonyms, sentence]
  );
  const viewKey = sentence ? replaceKey : baseKey;

  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [baseResult, setBaseResult] = useState<SynonymDiffResult | null>(null);
  const [displayResult, setDisplayResult] = useState<SynonymDiffResult | null>(
    null
  );
  const [cachedViewKey, setCachedViewKey] = useState('');

  useEffect(() => {
    if (
      storedSynonymDiffMatchesBase(stored, baseKey) &&
      (stored?.summary || stored?.items?.length)
    ) {
      const base = baseResultFromStored(stored!);
      setBaseResult(base);
      if (sentence) {
        setDisplayResult(null);
        setCachedViewKey('');
      } else {
        setDisplayResult(base);
        setCachedViewKey(baseKey);
      }
      return;
    }
    setOpen(false);
    setBaseResult(null);
    setDisplayResult(null);
    setCachedViewKey('');
  }, [baseKey, sentence, stored?.key, stored?.summary, stored?.items?.length]);

  const usable = synonyms.filter((s) => {
    const w = String(s.word || '').trim().toLowerCase();
    return w && w !== headword.trim().toLowerCase();
  });

  async function ensureBaseDiff(): Promise<SynonymDiffResult | null> {
    if (baseResult?.items.length || baseResult?.summary) return baseResult;
    if (
      storedSynonymDiffMatchesBase(stored, baseKey) &&
      (stored?.summary || stored?.items?.length)
    ) {
      const base = baseResultFromStored(stored);
      setBaseResult(base);
      return base;
    }
    const next = await explainSynonymDifferences(
      headword,
      translation,
      usable,
      settings,
      {}
    );
    if (!next.summary && !next.items.length) return null;
    setBaseResult(next);
    const payload = toPersistedSynonymDiff(baseKey, next);
    try {
      await onSave?.(payload);
    } catch {
      /* 展示仍可用 */
    }
    return next;
  }

  async function ensureReplaceOverlay(
    base: SynonymDiffResult
  ): Promise<SynonymDiffResult | null> {
    const sent = sentence.trim();
    if (!sent) return base;
    const replaceItems = await judgeSynonymReplaceInSentence(
      headword,
      translation,
      usable,
      sent,
      settings
    );
    if (!replaceItems.length) {
      message.warning('未生成本句替换判断，请重试');
      return null;
    }
    return mergeReplaceIntoBase(base, sent, replaceItems);
  }

  async function run() {
    if (!usable.length) {
      message.warning('请先有近义词再辨析');
      return;
    }
    const viewReady =
      displayResult &&
      cachedViewKey === viewKey &&
      (!sentence || hasReplaceJudgment(displayResult));
    if (viewReady) {
      setOpen((v) => !v);
      return;
    }
    if (!settings.apiKey) {
      message.warning('请先在设置里填 API Key');
      return;
    }
    setBusy(true);
    try {
      const base = await ensureBaseDiff();
      if (!base) {
        message.warning('未生成辨析，请重试');
        return;
      }
      let shown: SynonymDiffResult = base;
      if (sentence) {
        const merged = await ensureReplaceOverlay(base);
        if (!merged) return;
        shown = merged;
      }
      setDisplayResult(shown);
      setCachedViewKey(viewKey);
      setOpen(true);
    } catch (e) {
      message.error(
        'AI 辨析失败：' + (e instanceof Error ? e.message : '未知错误')
      );
    } finally {
      setBusy(false);
    }
  }

  const viewReady =
    !!(displayResult && cachedViewKey === viewKey) &&
    (!sentence || hasReplaceJudgment(displayResult));
  const hasBaseOnly =
    !!baseResult && !sentence && cachedViewKey === baseKey;
  const label = busy
    ? sentence && baseResult && !hasReplaceJudgment(displayResult)
      ? '判断本句…'
      : '辨析中…'
    : viewReady && open
      ? '收起辨析'
      : viewReady || hasBaseOnly
        ? '查看辨析'
        : sentence && baseResult
          ? '本句辨析'
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

  const panel = open && displayResult ? <DiffPanel result={displayResult} /> : null;

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
