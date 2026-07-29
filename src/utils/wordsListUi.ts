/**
 * Persist WordsPage UI so returning from word detail keeps place.
 * Uses TanStack Virtual snapshot + scrollOffset for exact restore.
 */
const KEY = 'ielts-words-list-ui';

export type WordsListMeasurement = {
  index: number;
  key: string | number;
  start: number;
  size: number;
  end: number;
  lane: number;
};

export type WordsListUiState = {
  filter: string;
  categoryFilter: string | null;
  search: string;
  scrollTop: number;
  measurements: WordsListMeasurement[];
};

const DEFAULT: WordsListUiState = {
  filter: 'all',
  categoryFilter: null,
  search: '',
  scrollTop: 0,
  measurements: [],
};

function normalizeMeasurements(raw: unknown): WordsListMeasurement[] {
  if (!Array.isArray(raw)) return [];
  const out: WordsListMeasurement[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (typeof o.index !== 'number' || typeof o.start !== 'number') continue;
    if (typeof o.size !== 'number' || typeof o.end !== 'number') continue;
    out.push({
      index: o.index,
      key: (o.key as string | number) ?? o.index,
      start: o.start,
      size: o.size,
      end: o.end,
      lane: typeof o.lane === 'number' ? o.lane : 0,
    });
  }
  return out;
}

export function readWordsListUi(): WordsListUiState {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<WordsListUiState>;
    return {
      filter: typeof parsed.filter === 'string' ? parsed.filter : DEFAULT.filter,
      categoryFilter:
        parsed.categoryFilter === null || typeof parsed.categoryFilter === 'string'
          ? parsed.categoryFilter ?? null
          : null,
      search: typeof parsed.search === 'string' ? parsed.search : '',
      scrollTop:
        typeof parsed.scrollTop === 'number' && Number.isFinite(parsed.scrollTop)
          ? Math.max(0, parsed.scrollTop)
          : 0,
      measurements: normalizeMeasurements(parsed.measurements),
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function writeWordsListUi(patch: Partial<WordsListUiState>): void {
  try {
    const next = { ...readWordsListUi(), ...patch };
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}
