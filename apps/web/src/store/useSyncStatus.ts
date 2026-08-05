/**
 * Cloud pull status — so UI can show "正在同步" instead of an empty word list.
 */
import { create } from 'zustand';

interface SyncStatusState {
  pulling: boolean;
  pulledCount: number;
  beginPull: () => void;
  setPulledCount: (n: number) => void;
  endPull: () => void;
}

export const useSyncStatus = create<SyncStatusState>((set) => ({
  pulling: false,
  pulledCount: 0,
  beginPull: () => set({ pulling: true, pulledCount: 0 }),
  setPulledCount: (n) => set({ pulledCount: n }),
  endPull: () => set({ pulling: false }),
}));
