/**
 * Auth store — username + password (kept locally for encryption).
 * Persisted to localStorage. Username is X-Profile header for cloud sync.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthState } from '@/types/user';

interface AuthStore extends AuthState {
  setAuth: (username: string, password: string) => void;
  clear: () => void;
}

export const useAuth = create<AuthStore>()(
  persist(
    (set) => ({
      username: '',
      password: '',
      setAuth: (username, password) => set({ username, password }),
      clear: () => set({ username: '', password: '' }),
    }),
    {
      name: 'ielts-auth',
      // Only persist username + password; functions don't need persisting
      partialize: (state) => ({ username: state.username, password: state.password }),
    }
  )
);
