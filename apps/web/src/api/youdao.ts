/**
 * Youdao dictionary lookup (unofficial jsonapi).
 *
 * Browser cannot call dict.youdao.com directly (no CORS), so:
 * - Prefer Worker proxy: GET {workerUrl}/api/youdao?q=
 * - Dev fallback: Vite proxy /youdao-proxy → dict.youdao.com
 *
 * Worker route to add (CloudBase vocab-api):
 *
 *   if (path === '/api/youdao') {
 *     if (method !== 'GET') return err('Method not allowed', 405);
 *     const qs = event.queryStringParameters || event.queryString || {};
 *     const q = String(qs.q || '').trim();
 *     if (!q || q.length > 64) return err('需要 ?q=单词', 400);
 *     const dicts = encodeURIComponent(JSON.stringify({
 *       count: 4, dicts: [['ec'], ['syno'], ['phrs'], ['rel_word']],
 *     }));
 *     const url = 'https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(q) + '&dicts=' + dicts;
 *     const yd = await fetch(url, { headers: { Accept: 'application/json' } });
 *     if (!yd.ok) return err('有道上游失败：' + yd.status, 502);
 *     return ok({ ok: true, data: await yd.json() });
 *   }
 */

import type { Settings } from '@/types/settings';
import { isPlausibleLemmaReduction } from '@/utils/inflections';
import type { Collocation, Derivative, RelatedWord } from '@/types/word';

export class YoudaoError extends Error {}

export interface YoudaoLookupResult {
  lemma: string;
  /** e.g. 复数 — when input was an inflected form */
  formNote?: string;
  phoneticUs?: string;
  phoneticUk?: string;
  partOfSpeech?: string;
  translation: string;
  synonyms: RelatedWord[];
  dictCollocations: Collocation[];
  derivatives: Derivative[];
}

function lettersOnly(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function unwrapI(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(unwrapI).join('');
  if (typeof node === 'object' && node !== null && 'i' in node) {
    return unwrapI((node as { i: unknown }).i);
  }
  return '';
}

function shortGloss(tran: string, max = 24): string {
  return String(tran || '')
    .replace(/\b(n|v|vt|vi|adj|adv|prep|conj|pron|art|num|int|aux)\.?\/?/gi, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/^\[[^\]]*\]\s*/, '')
    .split(/[；;，,/、|]/)[0]
    .trim()
    .slice(0, max);
}

function isOkLemma(s: string): boolean {
  if (!s || s.length < 2 || s.length > 24) return false;
  if (/\s/.test(s)) return false;
  return /^[A-Za-z]+(?:-[A-Za-z]+)*$/.test(s);
}

function isInflectionNoise(gloss: string): boolean {
  return /过去式|过去分词|现在分词|第三人称|复数形式|ing形式|的复数/.test(
    String(gloss || '')
  );
}

const DICTS_PARAM = encodeURIComponent(
  JSON.stringify({
    count: 4,
    dicts: [['ec'], ['syno'], ['phrs'], ['rel_word']],
  })
);

function getBase(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * Whether Youdao lookup can run.
 * Needs a server proxy (browser cannot call dict.youdao.com directly).
 * - settings.workerUrl → absolute API host
 * - otherwise same-origin `/api/youdao`（与登录空 workerUrl 时走相对路径一致）
 */
export function canUseYoudao(settings: Settings): boolean {
  // Relative /api works for Vite proxy + same-origin deploy; workerUrl for remote API.
  // LLM「API Base」是智谱等出题用，与有道查词无关。
  return typeof location !== 'undefined' || !!settings.workerUrl;
}

/** Build request URL (worker / same-origin /api/youdao). */
function buildFetchUrl(word: string, settings: Settings): string {
  const q = encodeURIComponent(word);
  if (settings.workerUrl) {
    return `${getBase(settings.workerUrl)}/api/youdao?q=${q}`;
  }
  // Match authLogin('') — same-origin API or Vite /api proxy
  return `/api/youdao?q=${q}`;
}

async function fetchYoudaoJson(
  word: string,
  settings: Settings
): Promise<Record<string, unknown>> {
  const url = buildFetchUrl(word.trim(), settings);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (settings.syncToken) {
    headers['Authorization'] = `Bearer ${settings.syncToken}`;
  }
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    throw new YoudaoError(`有道查词失败 HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as Record<string, unknown>;
  // API may wrap as { ok, data } or return raw youdao JSON
  if (data && typeof data === 'object' && data.data && typeof data.data === 'object') {
    return data.data as Record<string, unknown>;
  }
  return data;
}

function formatEcTranslation(json: Record<string, unknown>, maxLen = 140): string {
  const ec = json.ec as { word?: Array<{ trs?: unknown[] }> } | undefined;
  const trs = ec?.word?.[0]?.trs;
  if (!Array.isArray(trs) || !trs.length) return '';
  const parts: string[] = [];
  for (const t of trs) {
    if (!t || typeof t !== 'object') continue;
    const row = t as { pos?: string; tr?: Array<{ l?: unknown }> };
    const pos = String(row.pos || '').trim();
    const texts = (row.tr || [])
      .map((x) => unwrapI(x?.l).trim())
      .filter(Boolean);
    if (!texts.length) continue;
    let body = texts.join('；');
    if (/【名】|（人名）|\(人名\)/.test(body)) continue;
    body = body
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!body) continue;
    parts.push(pos ? `${pos} ${body}` : body);
    if (parts.length >= 4) break;
  }
  let out = parts.join(' ').trim();
  if (out.length > maxLen) {
    out = out.slice(0, maxLen).replace(/[；，,\s]+$/, '') + '…';
  }
  return out;
}

function parsePhonetics(json: Record<string, unknown>): {
  phoneticUs: string;
  phoneticUk: string;
  partOfSpeech: string;
  prototype: string;
} {
  const ec = json.ec as
    | {
        word?: Array<{
          usphone?: string;
          ukphone?: string;
          prototype?: string;
          trs?: Array<{ pos?: string }>;
        }>;
      }
    | undefined;
  const w = ec?.word?.[0];
  const pos = String(w?.trs?.[0]?.pos || '').trim();
  const proto = String(w?.prototype || '').trim();
  let phoneticUs = String(w?.usphone || '').trim();
  let phoneticUk = String(w?.ukphone || '').trim();
  if (phoneticUs && !phoneticUs.startsWith('/')) phoneticUs = `/${phoneticUs}/`;
  if (phoneticUk && !phoneticUk.startsWith('/')) phoneticUk = `/${phoneticUk}/`;
  return { phoneticUs, phoneticUk, partOfSpeech: pos, prototype: proto };
}

function parseSynonyms(json: Record<string, unknown>, headword: string): RelatedWord[] {
  const head = lettersOnly(headword);
  const syno = json.syno as { synos?: unknown[] } | undefined;
  const blocks = syno?.synos;
  if (!Array.isArray(blocks)) return [];
  const out: RelatedWord[] = [];
  const seen = new Set([head]);
  for (const block of blocks.slice(0, 2)) {
    if (!block || typeof block !== 'object') continue;
    const syn = (block as { syno?: { tran?: string; ws?: Array<{ w?: string }> } }).syno;
    const gloss = shortGloss(String(syn?.tran || ''), 16);
    const ws = syn?.ws;
    if (!Array.isArray(ws)) continue;
    for (const item of ws) {
      const w = String(item?.w || '').trim();
      if (!isOkLemma(w)) continue;
      const key = lettersOnly(w);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ word: w.toLowerCase(), gloss, source: 'youdao' });
      if (out.length >= 6) return out;
    }
  }
  return out;
}

function parseCollocations(
  json: Record<string, unknown>,
  headword: string
): Collocation[] {
  const head = lettersOnly(headword);
  const phrs = json.phrs as { phrs?: unknown[] } | undefined;
  const list = phrs?.phrs;
  if (!Array.isArray(list)) return [];
  const out: Collocation[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const phr = (item as { phr?: { headword?: { l?: unknown }; trs?: Array<{ tr?: { l?: unknown } }> } })
      .phr;
    const phrase = unwrapI(phr?.headword?.l).trim();
    const glossRaw = unwrapI(phr?.trs?.[0]?.tr?.l).trim();
    if (!phrase || phrase.length < 3 || phrase.length > 48) continue;
    const pKey = phrase
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, ' ')
      .trim();
    if (!pKey.includes(head) && !lettersOnly(phrase).includes(head)) continue;
    if (seen.has(pKey)) continue;
    seen.add(pKey);
    out.push({
      phrase: phrase.toLowerCase(),
      gloss: shortGloss(glossRaw, 20),
    });
    if (out.length >= 8) break;
  }
  return out;
}

function parseDerivatives(
  json: Record<string, unknown>,
  headword: string
): Derivative[] {
  const head = lettersOnly(headword);
  const relWord = json.rel_word as { rels?: unknown[] } | undefined;
  const rels = relWord?.rels;
  if (!Array.isArray(rels)) return [];
  const out: Derivative[] = [];
  const seen = new Set([head]);
  for (const block of rels) {
    if (!block || typeof block !== 'object') continue;
    const rel = (block as { rel?: { pos?: string; words?: Array<{ word?: string; tran?: string }> } })
      .rel;
    const pos = String(rel?.pos || '').trim();
    const words = rel?.words;
    if (!Array.isArray(words)) continue;
    for (const item of words) {
      const w = String(item?.word || '').trim();
      const tran = String(item?.tran || '').trim();
      if (!isOkLemma(w)) continue;
      const key = lettersOnly(w);
      if (!key || seen.has(key) || key.length < 3) continue;
      if (head.startsWith(key) && head.length - key.length >= 4) continue;
      if (isInflectionNoise(tran)) continue;
      if (
        (key === `${head}ing` || key === `${head}ed` || key === `${head}s`) &&
        /分词|过去式|第三人称/.test(tran)
      ) {
        continue;
      }
      seen.add(key);
      out.push({
        word: w.toLowerCase(),
        gloss: shortGloss(tran),
        ...(pos ? { pos } : {}),
      });
      if (out.length >= 8) return out;
    }
  }
  return out;
}

function parseOne(
  json: Record<string, unknown>,
  lemma: string,
  typed: string
): YoudaoLookupResult {
  const { phoneticUs, phoneticUk, partOfSpeech } = parsePhonetics(json);
  const translation = formatEcTranslation(json);
  const formNote =
    lettersOnly(typed) !== lettersOnly(lemma) &&
    isPlausibleLemmaReduction(typed, lemma)
      ? '词形变化'
      : undefined;
  return {
    lemma,
    formNote,
    phoneticUs,
    phoneticUk,
    partOfSpeech,
    translation,
    synonyms: parseSynonyms(json, lemma),
    dictCollocations: parseCollocations(json, lemma),
    derivatives: parseDerivatives(json, lemma),
  };
}

/**
 * Look up a word (or inflection) via Youdao.
 * Inflected forms are reduced using ec.word[0].prototype when present.
 */
export async function lookupYoudaoWord(
  raw: string,
  settings: Settings
): Promise<YoudaoLookupResult> {
  const typed = raw.trim().toLowerCase().replace(/[^a-z'\-\s]/gi, '').trim();
  if (!typed) throw new YoudaoError('请输入单词');

  let json = await fetchYoudaoJson(typed, settings);
  const { prototype } = parsePhonetics(json);
  let lemma = typed.toLowerCase().trim();
  const proto = String(prototype || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z'-]/g, '');
  if (proto && isPlausibleLemmaReduction(typed, proto)) {
    lemma = proto;
  }

  if (lettersOnly(lemma) && lettersOnly(lemma) !== lettersOnly(typed)) {
    try {
      json = await fetchYoudaoJson(lemma, settings);
    } catch {
      /* keep first response */
    }
  }

  const result = parseOne(json, lemma || typed, typed);
  if (!result.translation && !result.phoneticUs && !result.phoneticUk) {
    throw new YoudaoError(`有道未找到「${typed}」`);
  }
  return result;
}
