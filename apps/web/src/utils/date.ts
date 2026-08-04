/** Local storage key helpers — keep keys backward-compatible with v5.x. */

import { useAuth } from '@/store/useAuth';

export function lsKey(name: string): string {
  const u = useAuth.getState().username || '_default';
  return u ? `ielts-${u}-${name}` : `ielts-${name}`;
}

export function getLS(name: string): string | null {
  try { return localStorage.getItem(lsKey(name)); } catch { return null; }
}

export function setLS(name: string, value: string): void {
  try { localStorage.setItem(lsKey(name), value); } catch { /* ignore */ }
}

export function delLS(name: string): void {
  try { localStorage.removeItem(lsKey(name)); } catch { /* ignore */ }
}

export function todayKey(): string {
  return new Date().toDateString();
}
