import { useState, useMemo, useRef, memo, useCallback, useEffect, useLayoutEffect } from 'react';
import { Popconfirm, App, Select, Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useUserWords, useWordsStore } from '@/store/useWords';
import { useCategories } from '@/store/useCategories';
import {
  isDue,
  isNew,
  isMastered,
} from '@/utils/scheduler';
import type { Word } from '@/types/word';
import { wordDetailPath } from '@/utils/wordId';
import { useWordDetailEntryNav } from '@/utils/wordDetailNav';
import PhoneticDisplay from '@/components/PhoneticDisplay';
import LetterIndexBar from '@/components/LetterIndexBar';
import { categoryLabel, normalizeCategories, TOPIC_CATEGORIES, FUNCTION_CATEGORIES } from '@/config/categories';
import { readWordsListUi, writeWordsListUi } from '@/utils/wordsListUi';
import { isCustomWord, ensureBankMap } from '@/utils/wordSyncPatch';

type Filter =
  | 'all'
  | 'due'
  | 'new'
  | 'learning'
  | 'mastered'
  | 'starred'
  | 'custom'
  | 'crossed';

const FILTER_KEYS: Filter[] = [
  'all',
  'due',
  'new',
  'learning',
  'mastered',
  'starred',
  'custom',
  'crossed',
];

function parseFilter(raw: string): Filter {
  return FILTER_KEYS.includes(raw as Filter) ? (raw as Filter) : 'all';
}

type ListRow =
  | { type: 'header'; letter: string; key: string }
  | { type: 'word'; word: Word; key: string };

function matchesFilter(w: Word, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'crossed') return !!w.crossedOut;
  if (filter === 'starred') return !!w.starred;
  if (filter === 'custom') return isCustomWord(w.word);
  if (w.crossedOut) return false;
  if (filter === 'new') return isNew(w);
  if (filter === 'due') return !isNew(w) && isDue(w);
  if (filter === 'mastered') return isMastered(w);
  if (filter === 'learning') {
    return !isNew(w) && !isDue(w) && !isMastered(w);
  }
  return true;
}

function wordInCategory(w: Word, cat: string | null): boolean {
  if (!cat) return true;
  if (cat === '__none__') return normalizeCategories(w.category).length === 0;
  return normalizeCategories(w.category).includes(cat);
}

function wordInitial(word: string): string {
  const ch = word.trim().charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
}

const WordListRow = memo(function WordListRow({
  w,
  onOpen,
  onToggleStarred,
  onToggleCrossed,
  onDelete,
}: {
  w: Word;
  onOpen: (id: string) => void;
  onToggleStarred: (w: Word, e: React.MouseEvent) => void;
  onToggleCrossed: (w: Word, e: React.MouseEvent) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className={`word-list-item ${w.crossedOut ? 'crossed' : ''}${w.starred ? ' is-starred' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(w.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(w.id);
        }
      }}
    >
      <div className="word-main">
        <div className="word-row">
          <span className="word">{w.word}</span>
          {w.starred ? (
            <span className="word-star-badge" title="星标" aria-hidden>
              ★
            </span>
          ) : null}
          <PhoneticDisplay word={w} withSpeak />
        </div>
        <div className={`translation ${w.translation ? '' : 'mute'}`}>
          {w.translation || '暂无翻译'}
        </div>
      </div>
      <div className="actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={w.starred ? 'star active' : 'star'}
          title={w.starred ? '取消星标' : '加星标'}
          onClick={(e) => onToggleStarred(w, e)}
        >
          {w.starred ? '★' : '☆'}
        </button>
        <button
          type="button"
          title={w.crossedOut ? '恢复' : '划掉'}
          onClick={(e) => onToggleCrossed(w, e)}
        >
          {w.crossedOut ? '↩' : '−'}
        </button>
        <Popconfirm
          title="确定删除？"
          onConfirm={() => onDelete(w.id)}
          okText="确定"
          cancelText="取消"
        >
          <button type="button" className="delete" title="删除">
            ✕
          </button>
        </Popconfirm>
      </div>
    </div>
  );
});

export default function WordsPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const entryNav = useWordDetailEntryNav();
  const words = useUserWords();
  const allCategories = useCategories((s) => s.all);
  const savedUi = useMemo(() => readWordsListUi(), []);
  const [filter, setFilter] = useState<Filter>(() => parseFilter(savedUi.filter));
  const [categoryFilter, setCategoryFilter] = useState<string | null>(
    () => savedUi.categoryFilter
  );
  const [search, setSearch] = useState(() => savedUi.search);
  const removeWord = useWordsStore((s) => s.removeWord);
  const updateWord = useWordsStore((s) => s.updateWord);
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollHideTimer = useRef<number | null>(null);
  const pendingScrollTop = useRef(savedUi.scrollTop);
  const pendingMeasurements = useRef(savedUi.measurements);
  const didRestoreScroll = useRef(false);
  const [scrolling, setScrolling] = useState(false);
  const [bankReady, setBankReady] = useState(false);

  useEffect(() => {
    void ensureBankMap().then(() => setBankReady(true));
  }, []);

  const counts = useMemo(() => {
    let neu = 0;
    let due = 0;
    let learning = 0;
    let mastered = 0;
    let crossed = 0;
    let starred = 0;
    let custom = 0;
    for (const w of words) {
      if (isCustomWord(w.word)) custom++;
      if (w.starred) starred++;
      if (w.crossedOut) {
        crossed++;
        continue;
      }
      if (isNew(w)) neu++;
      else if (isDue(w)) due++;
      else if (isMastered(w)) mastered++;
      else learning++;
    }
    return {
      all: words.length,
      new: neu,
      due,
      learning,
      mastered,
      starred,
      custom,
      crossed,
    };
  }, [words, bankReady]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: `全部 (${counts.all})` },
    { key: 'new', label: `新词 (${counts.new})` },
    { key: 'due', label: `待复习 (${counts.due})` },
    { key: 'learning', label: `学习中 (${counts.learning})` },
    { key: 'mastered', label: `已掌握 (${counts.mastered})` },
    { key: 'starred', label: `星标 (${counts.starred})` },
    { key: 'custom', label: `自建词 (${counts.custom})` },
    { key: 'crossed', label: `已划掉 (${counts.crossed})` },
  ];

  const categoryOptions = useMemo(() => {
    const cats = allCategories();
    const catCount = new Map<string, number>();
    let noneCount = 0;
    for (const w of words) {
      const cs = normalizeCategories(w.category);
      if (!cs.length) {
        noneCount++;
        continue;
      }
      for (const c of cs) catCount.set(c, (catCount.get(c) || 0) + 1);
    }
    const custom = cats.filter(
      (c) =>
        !(TOPIC_CATEGORIES as readonly string[]).includes(c) &&
        !(FUNCTION_CATEGORIES as readonly string[]).includes(c)
    );
    return [
      { value: '', label: `全部分组 (${words.length})` },
      { value: '__none__', label: `未分组 (${noneCount})` },
      {
        label: '话题',
        options: TOPIC_CATEGORIES.map((c) => ({
          value: c,
          label: `${categoryLabel(c)} (${catCount.get(c) || 0})`,
        })),
      },
      {
        label: '功能',
        options: FUNCTION_CATEGORIES.map((c) => ({
          value: c,
          label: `${categoryLabel(c)} (${catCount.get(c) || 0})`,
        })),
      },
      ...(custom.length
        ? [
            {
              label: '自定义',
              options: custom.map((c) => ({
                value: c,
                label: `${categoryLabel(c)} (${catCount.get(c) || 0})`,
              })),
            },
          ]
        : []),
    ];
  }, [words, allCategories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = words.filter((w) => {
      if (!matchesFilter(w, filter) || !wordInCategory(w, categoryFilter)) return false;
      if (!q) return true;
      return (
        w.word.toLowerCase().includes(q) ||
        (w.translation || '').toLowerCase().includes(q)
      );
    });
    list.sort((a, b) =>
      a.word.localeCompare(b.word, 'en', { sensitivity: 'base' })
    );
    return list;
  }, [words, filter, categoryFilter, search]);

  const { rows, letters, letterIndex } = useMemo(() => {
    const rows: ListRow[] = [];
    const letters: string[] = [];
    const letterIndex = new Map<string, number>();
    let prev = '';
    for (const w of filtered) {
      const letter = wordInitial(w.word);
      if (letter !== prev) {
        letterIndex.set(letter, rows.length);
        letters.push(letter);
        rows.push({ type: 'header', letter, key: `h-${letter}` });
        prev = letter;
      }
      rows.push({ type: 'word', word: w, key: w.id });
    }
    return { rows, letters, letterIndex };
  }, [filtered]);

  useEffect(() => {
    writeWordsListUi({ filter, categoryFilter, search });
  }, [filter, categoryFilter, search]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const onScroll = () => {
      setScrolling(true);
      if (scrollHideTimer.current) window.clearTimeout(scrollHideTimer.current);
      scrollHideTimer.current = window.setTimeout(() => setScrolling(false), 700);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (scrollHideTimer.current) window.clearTimeout(scrollHideTimer.current);
    };
  }, [rows.length]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.type === 'header' ? 28 : 72),
    overscan: 8,
    getItemKey: (index) => rows[index]?.key ?? index,
    initialOffset: pendingScrollTop.current,
    initialMeasurementsCache: pendingMeasurements.current as never,
  });

  // Keep scrollTop in sync after remount (snapshot already fed via initial*)
  useLayoutEffect(() => {
    if (didRestoreScroll.current || !rows.length) return;
    didRestoreScroll.current = true;
    const top = pendingScrollTop.current;
    if (top <= 0) return;
    const el = parentRef.current;
    if (!el) return;
    el.scrollTop = top;
    virtualizer.scrollToOffset(top, { align: 'start' });
  }, [rows.length, virtualizer]);

  const activeLetter = (() => {
    const items = virtualizer.getVirtualItems();
    if (!items.length) return '';
    const row = rows[items[0].index];
    if (!row) return '';
    return row.type === 'header' ? row.letter : wordInitial(row.word.word);
  })();

  const onSelectLetter = useCallback(
    (letter: string) => {
      const index = letterIndex.get(letter);
      if (index == null) return;
      virtualizer.scrollToIndex(index, { align: 'start' });
    },
    [letterIndex, virtualizer]
  );

  const onOpen = useCallback(
    (id: string) => {
      const el = parentRef.current;
      const scrollTop = el?.scrollTop ?? virtualizer.scrollOffset ?? 0;
      const snapshot = virtualizer.takeSnapshot();
      writeWordsListUi({
        filter,
        categoryFilter,
        search,
        scrollTop,
        measurements: snapshot.map((m) => ({
          index: m.index,
          key: typeof m.key === 'bigint' ? String(m.key) : m.key,
          start: m.start,
          size: m.size,
          end: m.end,
          lane: m.lane,
        })),
      });
      navigate(wordDetailPath(id), { state: entryNav });
    },
    [navigate, entryNav, filter, categoryFilter, search, virtualizer]
  );

  const onToggleStarred = useCallback(
    async (w: Word, e: React.MouseEvent) => {
      e.stopPropagation();
      const updated = { ...w, starred: !w.starred };
      await updateWord(updated);
      message.success(updated.starred ? '已加星标' : '已取消星标');
    },
    [updateWord, message]
  );

  const onToggleCrossed = useCallback(
    async (w: Word, e: React.MouseEvent) => {
      e.stopPropagation();
      const updated = { ...w, crossedOut: !w.crossedOut };
      await updateWord(updated);
      message.success(updated.crossedOut ? '已划掉' : '已恢复');
    },
    [updateWord, message]
  );

  const onDelete = useCallback(
    async (id: string) => {
      await removeWord(id);
      message.success('已删除');
    },
    [removeWord, message]
  );

  return (
    <div className="words-page">
      <div className="app-header">
        <h1>词表</h1>
        <p>
          共 {words.length} 个单词
          {filtered.length !== words.length ? ` · 筛选后 ${filtered.length}` : ''}
          {' · '}按字母排序 · 点词条查看详情
        </p>
      </div>

      <div className="filter-tabs">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`filter-tab ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="words-toolbar">
        <Input
          allowClear
          className="words-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索单词或释义"
          prefix={<SearchOutlined style={{ color: 'var(--text-mute)' }} />}
        />
        <Select
          className="words-category-filter"
          value={categoryFilter ?? ''}
          onChange={(v) => setCategoryFilter(v ? v : null)}
          options={categoryOptions}
          showSearch
          optionFilterProp="label"
          placeholder="按主题分组筛选"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="app-card empty">
          <div className="empty-icon">📭</div>
          <h3>这里空空如也</h3>
          <p>{words.length === 0 ? '去设置 → 数据添加几个新词吧' : '切换其他分类看看'}</p>
        </div>
      ) : (
        <div className="word-list-wrap">
          <div
            ref={parentRef}
            className={`word-virtual-list${scrolling ? ' is-scrolling' : ''}`}
          >
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((vi) => {
                const row = rows[vi.index];
                if (!row) return null;
                return (
                  <div
                    key={row.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    className={
                      row.type === 'header'
                        ? 'word-virtual-row word-letter-header-row'
                        : 'word-virtual-row'
                    }
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vi.start}px)`,
                    }}
                  >
                    {row.type === 'header' ? (
                      <div className="word-letter-header">{row.letter}</div>
                    ) : (
                      <WordListRow
                        w={row.word}
                        onOpen={onOpen}
                        onToggleStarred={onToggleStarred}
                        onToggleCrossed={onToggleCrossed}
                        onDelete={onDelete}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <LetterIndexBar
            letters={letters}
            activeLetter={activeLetter}
            onSelect={onSelectLetter}
          />
        </div>
      )}
    </div>
  );
}
