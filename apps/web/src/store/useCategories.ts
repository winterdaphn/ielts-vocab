/**
 * Category catalog — preset (真经) + user-defined custom groups.
 * Custom list is local-persisted; deleting a custom group strips it from all words.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  PRESET_CATEGORIES,
  isPresetCategory,
  categoryLabel,
} from '@/config/categories';
import { useWordsStore } from '@/store/useWords';
import { useAuth } from '@/store/useAuth';
import { db } from '@/db/ieltsDb';

interface CategoriesState {
  custom: string[];
  /** Preset + custom, sorted (preset order first, then custom) */
  all: () => string[];
  addCustom: (name: string) => { ok: boolean; error?: string };
  removeCustom: (name: string) => Promise<{ ok: boolean; error?: string }>;
}

function normalizeName(name: string): string {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

export const useCategories = create<CategoriesState>()(
  persist(
    (set, get) => ({
      custom: [],
      all: () => {
        const custom = get().custom.filter((c) => c && !isPresetCategory(c));
        return [...PRESET_CATEGORIES, ...custom];
      },
      addCustom: (raw) => {
        const name = normalizeName(raw);
        if (!name) return { ok: false, error: '分组名不能为空' };
        if (name.length > 24) return { ok: false, error: '分组名最多 24 字' };
        if (isPresetCategory(name)) return { ok: false, error: '与预置分组重名' };
        const all = get().all();
        if (all.some((c) => c === name || categoryLabel(c) === name)) {
          return { ok: false, error: '分组已存在' };
        }
        set({ custom: [...get().custom, name] });
        return { ok: true };
      },
      removeCustom: async (raw) => {
        const name = normalizeName(raw);
        if (!name) return { ok: false, error: '无效分组' };
        if (isPresetCategory(name)) {
          return { ok: false, error: '预置分组不能删除' };
        }
        if (!get().custom.includes(name)) {
          return { ok: false, error: '找不到该自定义分组' };
        }
        set({ custom: get().custom.filter((c) => c !== name) });

        // Strip from current user's words
        const userId = useAuth.getState().username;
        if (userId) {
          const rows = await db.words.where('userId').equals(userId).toArray();
          const updateWord = useWordsStore.getState().updateWord;
          for (const row of rows) {
            const cats = Array.isArray(row.category) ? row.category : [];
            if (!cats.includes(name)) continue;
            await updateWord({
              ...row,
              category: cats.filter((c) => c !== name),
            });
          }
        }
        return { ok: true };
      },
    }),
    { name: 'ielts-categories' }
  )
);
