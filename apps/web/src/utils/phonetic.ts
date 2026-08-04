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
  /** @deprecated legacy single IPA */
  phonetic?: string;
  phoneticUs?: string;
  phoneticUk?: string;
}

/** Resolve US / UK IPA; falls back to legacy `phonetic` for old records. */
export function resolvePhonetics(w?: PhoneticFields | null): { us: string; uk: string } {
  if (!w) return { us: '', uk: '' };
  const legacy = normalizePhonetic(w.phonetic);
  const us = normalizePhonetic(w.phoneticUs) || legacy;
  const uk = normalizePhonetic(w.phoneticUk) || legacy;
  return { us, uk };
}

/** Fill missing Us/Uk from legacy `phonetic`; drop writing the redundant key. */
export function migratePhoneticFields(w?: PhoneticFields | null): {
  phoneticUs: string;
  phoneticUk: string;
} {
  if (!w) return { phoneticUs: '', phoneticUk: '' };
  const legacy = (w.phonetic || '').trim();
  return {
    phoneticUs: (w.phoneticUs || '').trim() || legacy,
    phoneticUk: (w.phoneticUk || '').trim() || legacy,
  };
}

/** Plain-text display: 美 /…/ · 英 /…/ when they differ. */
export function formatPhoneticDisplay(w?: PhoneticFields | null): string {
  const { us, uk } = resolvePhonetics(w);
  if (us && uk && us !== uk) return `美 ${us} · 英 ${uk}`;
  return us || uk || '';
}
