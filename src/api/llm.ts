/**
 * LLM API — OpenAI-compatible chat completions.
 * Used for example generation and answer judging.
 */

import type { Settings } from '@/types/settings';
import type { Word } from '@/types/word';
import { PROVIDERS } from '@/config/providers';
import { areInflectionVariants } from '@/utils/inflections';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export class LLMError extends Error {}

/** Strip markdown fences / leading junk so JSON.parse can succeed. */
export function parseJsonLoose<T = unknown>(raw: string): T {
  let s = String(raw || '').trim();
  if (!s) throw new SyntaxError('empty LLM response');

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  const startObj = s.indexOf('{');
  const startArr = s.indexOf('[');
  let start = -1;
  if (startObj < 0) start = startArr;
  else if (startArr < 0) start = startObj;
  else start = Math.min(startObj, startArr);
  if (start > 0) s = s.slice(start);

  const endObj = s.lastIndexOf('}');
  const endArr = s.lastIndexOf(']');
  const end = Math.max(endObj, endArr);
  if (end >= 0) s = s.slice(0, end + 1);

  return JSON.parse(s) as T;
}

function looksLikeJsonModeUnsupported(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  return /response_format|json_object|json mode|unsupported|unknown parameter|invalid.?param|not support/i.test(
    body
  );
}

export async function callLLM(
  messages: ChatMessage[],
  settings: Settings,
  options: CallOptions = {}
): Promise<string> {
  if (!settings.apiKey) throw new LLMError('未设置 API Key');
  if (!settings.apiBase) throw new LLMError('未设置 API Base URL');

  const model = settings.model || PROVIDERS[settings.provider]?.model || 'gpt-4o-mini';
  const url = settings.apiBase.replace(/\/$/, '') + '/chat/completions';

  async function post(useJsonMode: boolean): Promise<Response> {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (useJsonMode) body.response_format = { type: 'json_object' };

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + settings.apiKey,
      },
      body: JSON.stringify(body),
    });
  }

  let usedJson = !!options.jsonMode;
  let resp = await post(usedJson);

  if (!resp.ok && usedJson) {
    const errText = await resp.text().catch(() => '');
    if (looksLikeJsonModeUnsupported(resp.status, errText)) {
      console.warn(
        '[llm] response_format/json_object unsupported, retrying without it'
      );
      usedJson = false;
      resp = await post(false);
    } else {
      throw new LLMError(`API ${resp.status}: ${errText.slice(0, 200)}`);
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new LLMError(`API ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  const finish = data.choices?.[0]?.finish_reason;
  if (finish === 'length') {
    console.warn('[llm] response truncated (finish_reason=length); raise max_tokens');
  }
  if (!String(content).trim()) {
    throw new LLMError('API 返回空内容，请换模型或检查额度');
  }
  return content;
}

export async function testConnection(settings: Settings): Promise<string> {
  return callLLM(
    [{ role: 'user', content: 'Reply with just the word "ok" and nothing else.' }],
    settings,
    { temperature: 0 }
  );
}

// --- Word-specific prompts ---

export interface GeneratedExample {
  en: string;
  zh: string;
  blank?: string;
  highlighted?: string;
  choiceA?: string;
  choiceB?: string;
  choiceC?: string;
  choiceD?: string;
  answer?: 'A' | 'B' | 'C' | 'D';
  explanation?: string;
}

const EXAMPLE_SYSTEM = `You are an IELTS writing tutor. For each word, generate 2-3 example sentences at C1+ level. For each example, provide a multiple-choice cloze (4 options testing the target word vs similar distractors).

Output JSON: { "examples": [{ "en": "...", "zh": "...", "blank": "_____", "choiceA": "...", "choiceB": "...", "choiceC": "...", "choiceD": "...", "answer": "A", "explanation": "..." }] }

Constraints:
- Sentences should be relevant to IELTS writing topics (environment, education, technology, society, health, work)
- The target word must fit naturally; do NOT force it
- "blank" is the literal word being tested (case-sensitive match)
- Distractors are similar in length and grammatical fit but wrong meaning
- "answer" is "A"/"B"/"C"/"D"
- Output ONLY valid JSON, no preamble`;

export async function generateExamples(word: Word, settings: Settings): Promise<GeneratedExample[]> {
  const content = `Generate examples for the word: "${word.word}" (${word.translation})
Phonetic: ${word.phonetic || 'N/A'}
Part of speech: ${word.partOfSpeech || 'N/A'}`;

  const text = await callLLM(
    [
      { role: 'system', content: EXAMPLE_SYSTEM },
      { role: 'user', content },
    ],
    settings,
    { temperature: 0.8, jsonMode: true }
  );

  try {
    const parsed = parseJsonLoose<{ examples?: GeneratedExample[] }>(text);
    if (Array.isArray(parsed.examples)) {
      return parsed.examples.map((e: GeneratedExample) => ({
        en: e.en,
        zh: e.zh,
        blank: e.blank || word.word,
        choiceA: e.choiceA,
        choiceB: e.choiceB,
        choiceC: e.choiceC,
        choiceD: e.choiceD,
        answer: e.answer,
        explanation: e.explanation,
      }));
    }
  } catch {
    // fall through
  }
  return [];
}

export interface JudgeResult {
  score: number;        // 0-100 (match example.html)
  correct: boolean;
  feedback: string;
  improved?: string;
}

export interface ClozeJudgeResult {
  correct: boolean;
  expected: string;
  feedback: string;
  wordCompare?: string;
  usageTip?: string;
  grammarTip?: string;
}

export interface SentenceStructureAnalysis {
  overview: string;
  clauses: string;
}

/**
 * AI sentence-structure breakdown for cloze / choice review.
 * Helps learners parse long IELTS-style sentences.
 */
export async function analyzeSentenceStructure(
  sentenceEn: string,
  sentenceZh: string,
  targetWord: string,
  settings: Settings
): Promise<SentenceStructureAnalysis | null> {
  const en = String(sentenceEn || '').trim();
  if (!en) return null;
  if (!settings.apiKey) return null;

  const prompt = `你是雅思英语老师。请用简洁中文拆解下面这句英语的句法结构，帮助学习者看懂长句。

英文句子：${en}
中文参考：${sentenceZh || '（无）'}
本题相关词（仅作语境参考，不要单独做词义讲解）："${targetWord}"

要求：
1) 不要整句重译；重点讲句子怎么拆、成分怎么挂。
2) 主干、层次里必须同时给出对应的英文片段 + 中文说明（英文可短引，中文解释角色）。
3) 可点出关键语法点（定语从句、状语、被动、非谓语等），用语通俗。
4) 不要单独写「本词释义 / 词性讲解」板块。

Return JSON ONLY:
{
  "overview": "主干：英文核心结构 + 中文说明（例：The app received praise — 主语+谓语+宾语）",
  "clauses": "层次拆解，用①②③分点；每点格式：英文片段 — 中文（成分/语法）。2-5点即可"
}`;

  try {
    const text = await callLLM([{ role: 'user', content: prompt }], settings, {
      temperature: 0.35,
      jsonMode: true,
    });
    const parsed = JSON.parse(text);
    const overview = String(parsed.overview || '').trim();
    const clauses = String(parsed.clauses || '').trim();
    if (!overview && !clauses) return null;
    return { overview, clauses };
  } catch (e) {
    console.warn('[practice] structure analysis failed', e);
    return null;
  }
}

/** Extract the word form as it appears in the cloze sentence. */
export function getClozeExpectedForm(targetWord: string, sentence: string): string {
  const w = targetWord.trim();
  if (!w || !sentence) return w;
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    '\\b' + esc + '(?:s|es|ed|ing|ings|er|ers|est|ly|ies|ied)?\\b',
    'i'
  );
  const m = sentence.match(re);
  return m ? m[0] : w;
}

/**
 * Judge typed cloze answer. Fast-path: inflection match → correct without LLM.
 * Wrong answers get LLM coaching (like example.html).
 */
export async function judgeCloze(
  targetWord: string,
  userInput: string,
  fullSentence: string,
  settings: Settings
): Promise<ClozeJudgeResult> {
  const expected = getClozeExpectedForm(targetWord, fullSentence);
  const typed = userInput.trim();
  if (!typed) {
    return { correct: false, expected, feedback: '请先填入单词' };
  }

  // Local fast path — accept target or fitting inflection
  if (
    typed.toLowerCase() === expected.toLowerCase() ||
    typed.toLowerCase() === targetWord.toLowerCase() ||
    areInflectionVariants(typed, targetWord) ||
    areInflectionVariants(typed, expected)
  ) {
    return { correct: true, expected, feedback: '正确！' };
  }

  if (!settings.apiKey) {
    return {
      correct: false,
      expected,
      feedback: `不对，本题答案是「${expected}」`,
    };
  }

  const esc = targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const highlighted = String(fullSentence || '').replace(
    new RegExp('\\b' + esc + '(?:s|ed|ing|es|ly|d|er|est)?\\b', 'gi'),
    '[' + targetWord + ']'
  );

  const prompt = `You are an IELTS English teacher evaluating a cloze (fill-in-the-blank) answer.

Target word: "${targetWord}"
User typed: "${typed}"
Full sentence (blank marked): "${highlighted}"

Judging rules:
1) Correct if the user typed the target word OR a grammatically fitting inflection, ignoring case.
2) Wrong if it is a different word (including near-synonyms), a misspelling, or a form that does not fit.
3) Be pedagogically helpful for wrong answers. Write ALL teaching text in concise Chinese.

Return JSON ONLY:
{
  "correct": true or false,
  "expected": "exact form as in the sentence",
  "feedback": "总评，1-2句中文",
  "wordCompare": "用词对比（用户词≠目标词时填写，否则空字符串）",
  "usageTip": "搭配建议（有则填，无则空）",
  "grammarTip": "语法纠正（有则填，无则空）"
}`;

  try {
    const text = await callLLM([{ role: 'user', content: prompt }], settings, {
      temperature: 0.3,
      jsonMode: true,
    });
    const parsed = JSON.parse(text);
    return {
      correct: !!parsed.correct,
      expected: parsed.expected || expected,
      feedback: parsed.feedback || '',
      wordCompare: parsed.wordCompare || undefined,
      usageTip: parsed.usageTip || undefined,
      grammarTip: parsed.grammarTip || undefined,
    };
  } catch {
    return {
      correct: false,
      expected,
      feedback: `不对，本题答案是「${expected}」`,
    };
  }
}

export type TranslateHints = {
  /** 大致句型结构（中文，不含完整英文答案） */
  structure: string;
  /** 关键词 / 固定搭配（中文说明 + 少量英文词块，勿拼成整句） */
  keywords: string;
};

/**
 * Progressive hints for Chinese→English translation.
 * Call once; UI reveals structure → keywords → full answer step by step.
 */
export async function generateTranslateHints(
  targetWord: string,
  chinese: string,
  referenceEn: string,
  settings: Settings
): Promise<TranslateHints> {
  if (!settings.apiKey) {
    return {
      structure: `可先搭出「主语 + 谓语 + 宾语」的骨架，并自然用上「${targetWord}」。`,
      keywords: `必用词：${targetWord}；其余按中文意思选常用搭配即可。`,
    };
  }

  const prompt = `You are an IELTS English tutor. Student must translate Chinese → English and use the target word.

Target word: "${targetWord}"
Chinese: "${chinese}"
Reference English (for YOUR eyes only — NEVER copy it into the hints): "${referenceEn}"

Produce TWO progressive hints in Chinese. Do NOT reveal the full English sentence. Do NOT paraphrase the whole reference into English.

1) structure: a rough sentence frame / clause order (e.g. 「主语 + 时间状语 + 谓语 + that 宾语从句」). 1–2 short Chinese sentences. No full English clause.
2) keywords: 3–6 useful English chunks / collocations (words or short phrases only) with brief Chinese glosses. May include "${targetWord}". Must NOT string them into a complete sentence that matches the answer.

Return JSON ONLY:
{
  "structure": "...",
  "keywords": "..."
}`;

  const text = await callLLM([{ role: 'user', content: prompt }], settings, {
    temperature: 0.4,
    jsonMode: true,
  });

  try {
    const parsed = JSON.parse(text) as Partial<TranslateHints>;
    const structure = String(parsed.structure || '').trim();
    const keywords = String(parsed.keywords || '').trim();
    if (!structure && !keywords) throw new Error('empty');
    return {
      structure:
        structure ||
        `可先搭出「主语 + 谓语 + 宾语」的骨架，并自然用上「${targetWord}」。`,
      keywords: keywords || `必用词：${targetWord}`,
    };
  } catch {
    return {
      structure: `可先搭出「主语 + 谓语 + 宾语」的骨架，并自然用上「${targetWord}」。`,
      keywords: `必用词：${targetWord}；注意时态和常见搭配。`,
    };
  }
}

export async function judgeTranslation(
  targetWord: string,
  chinese: string,
  referenceEn: string,
  userTranslation: string,
  settings: Settings
): Promise<JudgeResult> {
  const prompt = `You are an English teacher evaluating a Chinese-to-English translation exercise.

Word being practiced: "${targetWord}"
Chinese sentence: "${chinese}"
Reference English: "${referenceEn}"
User's translation: "${userTranslation}"

Evaluate the user's translation:
- Meaning accuracy is most important (does it convey the same meaning as the reference?)
- Grammar and naturalness
- Whether the user correctly used "${targetWord}"
- Spelling and basic grammar

Be REASONABLE and lenient: accept translations that convey the same meaning even with different structure.
Be strict about: incorrect meaning, missing key information, severe grammar errors.

Scoring guide:
- 90-100: excellent, same meaning, natural
- 75-89: good, mostly correct
- 60-74: needs improvement, partial meaning
- 0-59: wrong, different meaning or major errors

Return JSON:
{
  "score": 0-100,
  "correct": true or false,
  "feedback": "specific feedback in Chinese, 1-2 sentences",
  "improvedVersion": "a slightly improved English version if user's has minor issues, otherwise empty string"
}
Rule: "correct" must be true if and only if score >= 75.
Output ONLY valid JSON.`;

  const text = await callLLM([{ role: 'user', content: prompt }], settings, {
    temperature: 0.2,
    jsonMode: true,
  });

  try {
    const parsed = JSON.parse(text);
    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    return {
      score,
      correct: parsed.correct != null ? !!parsed.correct : score >= 75,
      feedback: parsed.feedback || '',
      improved: parsed.improvedVersion || parsed.improved || undefined,
    };
  } catch {
    return { score: 0, correct: false, feedback: '评判失败，请重试' };
  }
}

export async function lookupWordInfo(word: string, settings: Settings): Promise<{
  phonetic?: string;
  partOfSpeech?: string;
  translation?: string;
  mnemonic?: string;
}> {
  const text = await callLLM(
    [
      {
        role: 'system',
        content: `You are an IELTS vocabulary assistant. Given an English word, output JSON:
{ "phonetic": "IPA in /.../", "partOfSpeech": "n./v./adj./adv.", "translation": "最常见的中文释义", "mnemonic": "a short Chinese memory aid (≤20字)" }
Output ONLY valid JSON.`,
      },
      { role: 'user', content: word },
    ],
    settings,
    { temperature: 0.2, jsonMode: true }
  );

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** 词根词缀 / 联想助记（中文）— mirrors example.html generateMnemonicTip */
export async function generateMnemonicTip(word: string, settings: Settings): Promise<string> {
  if (!word.trim() || !settings.apiKey) return '';
  const prompt = `为雅思学习者写英文词「${word}」的助记提示（用中文，1–3 句）。

优先顺序：
1) 词根 / 前缀 / 后缀拆解（有把握再写语源；不要编造离谱词源）
2) 构词联想、近义对比、画面记忆
3) 若实在无明显词缀，给一句好记的用法/场景提示

不要写成完整例句翻译。只要助记。

Return JSON ONLY:
{ "mnemonic": "..." }`;
  const text = await callLLM([{ role: 'user', content: prompt }], settings, {
    temperature: 0.4,
    jsonMode: true,
  });
  try {
    const parsed = JSON.parse(text) as { mnemonic?: string };
    return String(parsed?.mnemonic || '').trim();
  } catch {
    return '';
  }
}

// --- Practice batch generation (mirrors example.html) ---

export interface PracticeSentence {
  en: string;
  zh: string;
  /** Where this sentence came from — for debug UI */
  source?: SentenceSource;
}

export type SentenceSource = 'llm' | 'fallback' | 'cache' | 'session';

export function sentenceSourceLabel(source?: SentenceSource): string {
  if (source === 'llm') return 'AI生成';
  if (source === 'cache') return '词条缓存';
  if (source === 'session') return '进度恢复';
  if (source === 'fallback') return '备用句(旧)';
  return '未知来源';
}

function glossSnippet(word: Word): string {
  let t = (word.translation || '').split(/[；;]/)[0].trim();
  t = t.replace(/^(n\.|v\.|vt\.|vi\.|adj\.|adv\.|prep\.|conj\.)\s*/i, '').trim();
  // Prefer a single sense — avoid 「概念，观念」 style dumps in Chinese hints
  t = t.split(/[，,、\/]/)[0].trim();
  t = t.replace(/\b[A-Za-z][A-Za-z'-]+\b/g, '').replace(/\s{2,}/g, ' ').trim();
  return t || '该词';
}

/** Chinese cloze hint must not leave blank underlines (____) instead of the gloss. */
const CLOZE_ZH_BLANK_RE = /_{2,}|—{2,}|–{2,}|…{2,}|\.{3,}/g;

function hasClozeZhBlank(text: string): boolean {
  CLOZE_ZH_BLANK_RE.lastIndex = 0;
  return CLOZE_ZH_BLANK_RE.test(text);
}

function fillClozeZhBlanks(text: string, gloss: string): string {
  return text.replace(/_{2,}|—{2,}|–{2,}|…{2,}|\.{3,}/g, gloss);
}

/** Fill blank placeholders in Chinese hint with 词义 (no corner brackets). */
export function resolveClozeChinese(zh: string, word: Word): { text: string; gloss: string } {
  const gloss = glossSnippet(word);
  let text = String(zh || '').trim();
  if (hasClozeZhBlank(text)) {
    text = fillClozeZhBlanks(text, gloss);
  }
  // Strip legacy 「词义」 wrappers from older cached / fallback sentences
  text = text.replace(/「([^」]+)」/g, '$1');
  return { text, gloss };
}

/** Reject meta / tutorial sentences that talk ABOUT using the word. */
export function isLazyMetaSentence(en: string, word: string): boolean {
  const s = String(en || '').toLowerCase();
  const w = String(word || '').toLowerCase().trim();
  if (!s || !w) return true;
  if (/it is (very )?important to use/.test(s)) return true;
  if (/important to use .+ accurately/.test(s)) return true;
  if (new RegExp(`use (the )?(word )?${escapeReg(w)}`).test(s) && /accurate|appropriat|correct|proper|effectively/.test(s)) {
    return true;
  }
  if (/in academic writing/.test(s) && /\buse\b/.test(s) && s.includes(w)) return true;
  if (/this word (means|is useful|is important)/.test(s)) return true;
  if (/learn(?:ers)? should (remember|use|master)/.test(s)) return true;
  if (/a useful (word|vocabulary|term) for/.test(s)) return true;
  if (/fill in the blank|cloze exercise|target word/.test(s)) return true;
  return false;
}

/** Overused IELTS-exam frames that make a practice session feel copy-pasted. */
export function isStockTemplateSentence(en: string): boolean {
  const s = String(en || '').toLowerCase();
  if (!s) return true;
  if (/in writing task\s*2/.test(s)) return true;
  if (/opening paragraph/.test(s) && /candidat|essay|task/.test(s)) return true;
  if (/from the survey (data|results)/.test(s)) return true;
  if (/remote work (improved|improves|boosted)/.test(s)) return true;
  if (/critics (argue|claim|say|suggest|warn)/.test(s) && /law|policy|gap|regions/.test(s)) return true;
  if (/policymakers risk/.test(s)) return true;
  if (/economic growth should come before equity/.test(s)) return true;
  return false;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordHintLine(word: Word): string {
  const bits = [word.word];
  if (word.partOfSpeech) bits.push(word.partOfSpeech);
  const gloss = glossSnippet(word);
  if (gloss && gloss !== '该词') bits.push(gloss);
  return bits.join(' · ');
}

/** True only when two sentences are essentially the same (for regenerate avoid). */
function nearlySameSentence(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  // Content-word Jaccard — do NOT collapse all words to "#", that falsely flags every pair
  const content = (s: string) =>
    s.split(' ').filter((t) => t.length > 2 && !STOP_FOR_SIM.has(t));
  const ca = content(na);
  const cb = content(nb);
  if (!ca.length || !cb.length) return false;
  const setA = new Set(ca);
  let hit = 0;
  for (const t of cb) if (setA.has(t)) hit++;
  const union = new Set([...ca, ...cb]).size;
  return hit / Math.max(union, 1) >= 0.85 && Math.abs(ca.length - cb.length) <= 2;
}

const STOP_FOR_SIM = new Set([
  'a','an','the','and','or','but','to','of','in','on','for','with','from','that','this','these','those',
  'is','are','was','were','be','been','being','have','has','had','will','would','can','could','may','might',
  'it','its','they','them','their','he','she','his','her','we','our','you','your',
]);

function sentenceHasWord(sentence: string, word: string): boolean {
  const w = word.trim();
  if (!w || !sentence) return false;
  const esc = escapeReg(w);
  return new RegExp(
    '\\b' + esc + '(?:s|es|ed|ing|ings|er|ers|est|ly|ies|ied)?\\b',
    'i'
  ).test(sentence);
}

/** Chinese prompt must not contain English words or blank underlines (match example.html). */
function chineseIsFullyChinese(text: string, targetWord: string): boolean {
  const s = String(text || '').trim();
  if (!s) return false;
  if (sentenceHasWord(s, targetWord)) return false;
  if (/\b[A-Za-z][A-Za-z'-]+\b/.test(s)) return false;
  if (hasClozeZhBlank(s)) return false;
  return true;
}

function sanitizeChinese(text: string, word: Word): string {
  let s = String(text || '').trim();
  if (!s) return s;
  const gloss = glossSnippet(word);
  const w = word.word.trim();
  if (w && sentenceHasWord(s, w)) {
    const esc = escapeReg(w);
    s = s.replace(new RegExp('\\b' + esc + '(?:s|es|ed|ing|ies|ied)?\\b', 'gi'), gloss);
  }
  // LLM sometimes leaves ____ for the cloze slot — fill with the word's Chinese gloss
  if (hasClozeZhBlank(s)) {
    s = fillClozeZhBlanks(s, gloss);
  }
  s = s.replace(/\b[A-Za-z][A-Za-z'-]+\b/g, '').replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/\s+([，。！？、；：])/g, '$1').trim();
  // Drop corner brackets around gloss inserts
  s = s.replace(/「([^」]+)」/g, '$1');
  return s || `这句话描述的情境与${gloss}有关。`;
}

function practiceDifficultyRules(difficulty: 'easy' | 'medium' | 'hard'): string {
  if (difficulty === 'easy') {
    return `LENGTH / DIFFICULTY — EASY (strict):
- Prefer a SHORT sentence: about 6–12 English words (hard cap ~14).
- One simple clause only. No commas introducing extra clauses if possible.
- Everyday vocabulary; A2–B1 feel. No relative clauses, no "although/whereas/despite".
- Good: "The nurse checked her fever every hour."
- Bad (too long): "Although the nurse had already checked her fever twice that morning, she returned..."`;
  }
  if (difficulty === 'hard') {
    return `LENGTH / DIFFICULTY — HARD (strict):
- Write a LONG, complex IELTS-style sentence: aim 22–35 English words (minimum ~18).
- Use subordination / embedding: relative clauses, participles, or connectors (although, while, which, whose, having...).
- Keep it natural and concrete — not a definition, not a meta "how to use the word" line.
- C1 feel: denser syntax, but still one grammatical sentence (or one main + clearly linked subordinate).
- Good: "Having reviewed the lab samples overnight, the technician flagged a subtle anomaly which the earlier report had overlooked."
- Bad (too short/simple): "The technician found an anomaly."`;
  }
  return `LENGTH / DIFFICULTY — MEDIUM:
- One clear sentence of roughly 12–20 English words.
- B1–B2 level, natural and idiomatic (current default style).
- May include a light modifier or short relative clause, but avoid heavy nesting.`;
}

function practicePromptRules(
  mode: 'cloze' | 'translate',
  difficulty: 'easy' | 'medium' | 'hard' = 'medium'
): string {
  return `Quality rules (strict):
- Write ONE natural English sentence in a concrete everyday or IELTS-relevant situation.
- The target word must carry real meaning — a real scene, not a vocabulary tutorial.
${practiceDifficultyRules(difficulty)}
- DIVERSITY (critical): each word must use a DIFFERENT topic and setting. Rotate among food, travel, sport, health, family, shopping, nature, media, workplace, city life, science labs, etc. Do NOT reuse the same frame across items.

FORBIDDEN (these are automatic fails):
- Meta / tutorial lines about learning or "using" the word itself
- Patterns like "It is important to use X accurately", "In academic writing, use X appropriately", "X is a useful word", "This word means..."
- Defining the word inside the sentence
- Listing synonyms or giving usage advice instead of a real example
- Overused exam templates: "In Writing Task 2...", "From the survey data/results...", "Critics argue/claim that...", "policymakers", "remote work improved productivity", "opening paragraph"

Good: "Museum guides explained the concept behind the city's postwar rebuilding plan."
Bad: "In Writing Task 2, candidates often begin with a clear position in the opening paragraph."
Also bad (too template-like): "From the survey results, the team concluded that remote work improved productivity."

${
  mode === 'translate'
    ? `- translateChinese MUST be fully Chinese (no English/Latin words; do not leave the target word in Chinese)
- translateReference MUST contain the exact target word (or a common inflection) as a standalone word`
    : `- clozeEnglish MUST contain the exact target word (or a common inflection) as a standalone word
- clozeChinese MUST be a full Chinese translation (no English/Latin words; do not leave the target word in Chinese)
- clozeChinese MUST translate the blank/target word into Chinese naturally — never use ____ blanks, and do not wrap the Chinese gloss in corner brackets`
}`;
}

export type PracticeGenOptions = {
  /** Previous English sentences to avoid (e.g. when regenerating) */
  avoidEn?: string[];
  /** Higher creativity / stronger diversity reminder */
  diverse?: boolean;
  /** Sentence length / complexity */
  difficulty?: 'easy' | 'medium' | 'hard';
};

function englishWordCount(en: string): number {
  return en
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Soft length gate so easy/hard are not ignored by the model.
 *  Returns false only for extreme mismatches — borderline sentences are kept. */
function matchesDifficultyLength(
  en: string,
  difficulty: 'easy' | 'medium' | 'hard'
): boolean {
  const n = englishWordCount(en);
  // Extreme only — prompt already steers style; rejecting borderline caused "API ok but app fails"
  if (difficulty === 'easy') return n <= 28;
  if (difficulty === 'hard') return n >= 10;
  return true;
}

/**
 * One LLM request for multiple words (like example.html generateContentBatch).
 * Returns map wordId → { en, zh }. Missing ids mean generation failed — no template fallback.
 */
export async function generatePracticeBatch(
  words: Word[],
  mode: 'cloze' | 'translate',
  settings: Settings,
  opts?: PracticeGenOptions
): Promise<Record<string, PracticeSentence>> {
  if (!words.length) return {};
  const avoidEn = opts?.avoidEn?.filter(Boolean) || [];
  const diverse = opts?.diverse ?? avoidEn.length > 0;
  const difficulty = opts?.difficulty || 'medium';

  const accept = (en: string, word: string) => {
    if (!en || isLazyMetaSentence(en, word) || isStockTemplateSentence(en)) return false;
    if (avoidEn.some((a) => nearlySameSentence(en, a) || en.toLowerCase() === a.toLowerCase())) {
      return false;
    }
    if (!matchesDifficultyLength(en, difficulty)) {
      console.warn(
        '[practice] length mismatch',
        difficulty,
        englishWordCount(en),
        en.slice(0, 80)
      );
      return false;
    }
    return true;
  };

  const filterAccepted = (map: Record<string, PracticeSentence>, list: Word[]) => {
    const out: Record<string, PracticeSentence> = {};
    for (const w of list) {
      const s = map[w.id];
      if (s && accept(s.en, w.word)) out[w.id] = s;
      else if (s) console.warn('[practice] LLM rejected', w.word, s.en.slice(0, 80));
    }
    return out;
  };

  async function generateFor(list: Word[], reinforce: boolean) {
    if (!list.length) return {} as Record<string, PracticeSentence>;
    const raw = await generatePracticeBatchMany(list, mode, settings, {
      reinforce,
      avoidEn,
      difficulty,
    });
    return filterAccepted(raw, list);
  }

  let lastErr: unknown = null;
  let result: Record<string, PracticeSentence> = {};

  try {
    result = await generateFor(words, diverse);
  } catch (e) {
    lastErr = e;
    console.warn('[practice] LLM batch failed', e);
  }

  // Retry only missing / rejected words once with stronger diversity
  const missing = words.filter((w) => !result[w.id]);
  if (missing.length) {
    try {
      const retry = await generateFor(missing, true);
      result = { ...result, ...retry };
    } catch (e) {
      lastErr = e;
      console.warn('[practice] LLM retry failed', e);
    }
  }

  const stillMissing = words.filter((w) => !result[w.id]);
  if (stillMissing.length) {
    console.warn(
      '[practice] no sentence for',
      stillMissing.map((w) => w.word).join(', ')
    );
  }

  // If nothing usable and API errored, surface the real reason to the UI
  if (!Object.keys(result).length && lastErr) {
    throw lastErr instanceof Error ? lastErr : new LLMError(String(lastErr));
  }
  return result;
}

async function generatePracticeBatchMany(
  words: Word[],
  mode: 'cloze' | 'translate',
  settings: Settings,
  genOpts?: {
    reinforce?: boolean;
    avoidEn?: string[];
    difficulty?: 'easy' | 'medium' | 'hard';
  }
): Promise<Record<string, PracticeSentence>> {
  const reinforce = !!genOpts?.reinforce;
  const avoidEn = genOpts?.avoidEn?.filter(Boolean) || [];
  const difficulty = genOpts?.difficulty || 'medium';
  const hints = words.map((w) => wordHintLine(w)).join('\n- ');
  const reinforceBlock = reinforce
    ? `\nIMPORTANT: Prefer fresh, non-repetitive scenes. Do NOT write about "using the word". Avoid Writing Task 2 / survey / critics / remote-work clichés.\n`
    : '';
  const avoidBlock = avoidEn.length
    ? `\nDo NOT reuse or lightly paraphrase these previous sentences:\n${avoidEn.map((s) => `- ${s}`).join('\n')}\n`
    : '';
  const difficultyNudge =
    difficulty === 'easy'
      ? `\nREMINDER: Keep each English sentence SHORT (≈6–12 words).\n`
      : difficulty === 'hard'
        ? `\nREMINDER: Each English sentence must be LONG and complex (≈22–35 words) with clear subordination.\n`
        : '';

  const prompt =
    mode === 'translate'
      ? `You are an English vocabulary tutor for an IELTS test taker.
${reinforceBlock}${avoidBlock}${difficultyNudge}
Create a Chinese-to-English translation exercise for EACH target word below:
- ${hints}

${practicePromptRules('translate', difficulty)}

Return JSON EXACTLY:
{
  "items": [
    {"word": "example", "translateChinese": "...", "translateReference": "..."}
  ]
}
Include exactly one item per word, using the same spelling as given.
CRITICAL: the "items" array length MUST equal the number of target words. Do NOT output multiple items for the same word.`
      : `You are an English vocabulary tutor for an IELTS test taker.
${reinforceBlock}${avoidBlock}${difficultyNudge}
Create a cloze (fill-in-the-blank) exercise for EACH target word below:
- ${hints}

${practicePromptRules('cloze', difficulty)}

Return JSON EXACTLY:
{
  "items": [
    {"word": "example", "clozeEnglish": "...", "clozeChinese": "..."}
  ]
}
Include exactly one item per word, using the same spelling as given.
CRITICAL: the "items" array length MUST equal the number of target words (${words.length}). Do NOT output multiple items for the same word.`;

  // glm-4-flash 等模型默认 completion 常卡在 500，多词/多句时 JSON 会被截断
  const maxTokens = Math.max(2048, 600 + words.length * 280);

  const text = await callLLM([{ role: 'user', content: prompt }], settings, {
    temperature: reinforce || avoidEn.length ? 0.95 : 0.9,
    jsonMode: true,
    maxTokens,
  });

  let parsed: { items?: Array<Record<string, string>> };
  try {
    parsed = parseJsonLoose(text);
  } catch (e) {
    console.warn('[practice] LLM JSON parse failed', String(text).slice(0, 280), e);
    throw new LLMError('出题返回不是合法 JSON（可能被截断），请重试');
  }

  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  if (!items.length) {
    console.warn('[practice] LLM returned empty items', String(text).slice(0, 280));
    throw new LLMError('出题返回空题目，请重试或换模型');
  }

  // First item wins per word key (model sometimes dumps many variants of one word)
  const byWord: Record<string, Record<string, string>> = {};
  for (const it of items) {
    const key = String(it?.word || '')
      .toLowerCase()
      .trim();
    if (!key || byWord[key]) continue;
    byWord[key] = it;
  }

  function pickRaw(w: Word): Record<string, string> | null {
    const key = w.word.toLowerCase().trim();
    if (byWord[key]) return byWord[key];
    // fuzzy word field (inflection / extra spaces)
    for (const [k, it] of Object.entries(byWord)) {
      if (k === key || k.startsWith(key) || key.startsWith(k)) return it;
    }
    // single-word request: take first item whose English contains the target
    if (words.length === 1) {
      for (const it of items) {
        const en =
          mode === 'translate'
            ? String(it.translateReference || '')
            : String(it.clozeEnglish || '');
        if (en && sentenceHasWord(en, w.word)) return it;
      }
      return items[0] || null;
    }
    return null;
  }

  const result: Record<string, PracticeSentence> = {};
  for (const w of words) {
    const raw = pickRaw(w);
    if (!raw) continue;
    if (mode === 'translate') {
      let zh = String(raw.translateChinese || '').trim();
      const en = String(raw.translateReference || '').trim();
      if (!zh || !en || !sentenceHasWord(en, w.word)) continue;
      if (isLazyMetaSentence(en, w.word) || isStockTemplateSentence(en)) continue;
      if (!chineseIsFullyChinese(zh, w.word)) zh = sanitizeChinese(zh, w);
      result[w.id] = { zh, en, source: 'llm' };
    } else {
      const en = String(raw.clozeEnglish || '').trim();
      let zh = String(raw.clozeChinese || '').trim();
      if (!zh || !en || !sentenceHasWord(en, w.word)) continue;
      if (isLazyMetaSentence(en, w.word) || isStockTemplateSentence(en)) continue;
      if (!chineseIsFullyChinese(zh, w.word)) zh = sanitizeChinese(zh, w);
      result[w.id] = { en, zh, source: 'llm' };
    }
  }

  // Still empty but items exist → last-resort: bind first usable sentence to each missing word
  if (Object.keys(result).length === 0 && items.length && words.length === 1) {
    const w = words[0];
    for (const it of items) {
      const en =
        mode === 'translate'
          ? String(it.translateReference || '').trim()
          : String(it.clozeEnglish || '').trim();
      let zh =
        mode === 'translate'
          ? String(it.translateChinese || '').trim()
          : String(it.clozeChinese || '').trim();
      if (!en || !zh) continue;
      if (!sentenceHasWord(en, w.word)) continue;
      if (isLazyMetaSentence(en, w.word) || isStockTemplateSentence(en)) continue;
      if (!chineseIsFullyChinese(zh, w.word)) zh = sanitizeChinese(zh, w);
      result[w.id] = { en, zh, source: 'llm' };
      break;
    }
  }

  return result;
}

/** Build 4 MCQ options: target + 3 distractors from pool, shuffled. */
export function buildClozeChoices(
  target: string,
  distractorPool: string[]
): { choiceA: string; choiceB: string; choiceC: string; choiceD: string; answer: 'A' | 'B' | 'C' | 'D' } {
  const pool = distractorPool
    .map((w) => w.trim())
    .filter((w) => w && w.toLowerCase() !== target.toLowerCase());
  // shuffle pool
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const distractors = shuffled.slice(0, 3);
  while (distractors.length < 3) {
    distractors.push(['approach', 'concept', 'factor', 'method', 'aspect'][distractors.length]);
  }
  const options = [target, ...distractors].sort(() => Math.random() - 0.5);
  const letters = ['A', 'B', 'C', 'D'] as const;
  const answer = letters[options.findIndex((o) => o.toLowerCase() === target.toLowerCase())] || 'A';
  return {
    choiceA: options[0],
    choiceB: options[1],
    choiceC: options[2],
    choiceD: options[3],
    answer,
  };
}
