/**
 * In-flight cloud pull — for guards (e.g. avoid duplicate cold-start pull).
 * No UI; background sync logs to console only.
 */
import { create } from 'zustand';

interface SyncStatusState {
  pulling: boolean;
  setPulling: (v: boolean) => void;
}

export const useSyncStatus = create<SyncStatusState>((set) => ({
  pulling: false,
  setPulling: (v) => set({ pulling: v }),
}));
