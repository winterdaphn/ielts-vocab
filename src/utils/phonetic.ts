/**
 * Dual phonetic helpers — mirrors example.html formatPhoneticDisplay / normalizePhonetic.
 */

export function normalizePhonetic(ph?: string | null): string {
  if (!ph) return '';
  let s = String(ph).trim();
  if (!s) return '';
  s = s.replace(/^\/+|\/+$/g, '').trim();
  s = s.replace(/[''′＇`]/g, 'ˈ');
  s = s.replace(/ɹ/g, 'r');
  if (/ae/.test(s) && !/æ/.test(s)) s = s.replace(/ae/g, 'æ');
  return '/' + s + '/';
}

export interface PhoneticFields {
  phonetic?: string;
  phoneticUs?: string;
  phoneticUk?: string;
}

/** Resolve US / UK IPA with fallback to legacy `phonetic`. */
export function resolvePhonetics(w?: PhoneticFields | null): { us: string; uk: string } {
  if (!w) return { us: '', uk: '' };
  const main = normalizePhonetic(w.phonetic);
  const us = normalizePhonetic(w.phoneticUs) || main;
  const uk = normalizePhonetic(w.phoneticUk) || main;
  return { us, uk };
}

/** Plain-text display: 美 /…/ · 英 /…/ when they differ. */
export function formatPhoneticDisplay(w?: PhoneticFields | null): string {
  const { us, uk } = resolvePhonetics(w);
  if (us && uk && us !== uk) return `美 ${us} · 英 ${uk}`;
  return us || uk || '';
}
