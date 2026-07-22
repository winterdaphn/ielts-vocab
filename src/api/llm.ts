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

export async function callLLM(
  messages: ChatMessage[],
  settings: Settings,
  options: CallOptions = {}
): Promise<string> {
  if (!settings.apiKey) throw new LLMError('未设置 API Key');
  if (!settings.apiBase) throw new LLMError('未设置 API Base URL');

  const body: Record<string, unknown> = {
    model: settings.model || PROVIDERS[settings.provider]?.model || 'gpt-4o-mini',
    messages,
    temperature: options.temperature ?? 0.7,
  };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  if (options.jsonMode) body.response_format = { type: 'json_object' };

  const resp = await fetch(settings.apiBase.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new LLMError(`API ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? '';
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
    const parsed = JSON.parse(text);
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
}

function glossSnippet(word: Word): string {
  let t = (word.translation || '').split(/[；;]/)[0].trim();
  t = t.replace(/^(n\.|v\.|vt\.|vi\.|adj\.|adv\.|prep\.|conj\.)\s*/i, '').trim();
  t = t.replace(/\b[A-Za-z][A-Za-z'-]+\b/g, '').replace(/\s{2,}/g, ' ').trim();
  return t || '该词';
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

function pickFallbackIndex(word: string, n: number): number {
  let h = 0;
  for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
  return n ? h % n : 0;
}

/**
 * Natural contextual fallbacks — never the old "use X accurately" template.
 * Prefer part-of-speech when known; otherwise use versatile verb-slot frames.
 */
export function fallbackPracticeSentence(word: Word, mode: 'cloze' | 'translate'): PracticeSentence {
  const w = word.word;
  const gloss = glossSnippet(word);
  const pos = String(word.partOfSpeech || '').toLowerCase();

  type Pair = { en: string; zh: string };
  let pool: Pair[];

  if (/\bn\b|noun/.test(pos)) {
    pool = [
      {
        en: `The debate centres on a single ${w}: whether economic growth should come before equity.`,
        zh: `这场辩论围绕一个关键的「${gloss}」：经济增长是否应优先于公平。`,
      },
      {
        en: `Without reliable ${w}, policymakers risk designing reforms that fail ordinary families.`,
        zh: `若缺乏可靠的「${gloss}」，政策制定者可能推出让普通家庭受损的改革。`,
      },
      {
        en: `Her essay opens with a clear ${w} and then supports it with local case studies.`,
        zh: `她的文章以明确的「${gloss}」开头，再用地方案例加以支撑。`,
      },
    ];
  } else if (/\badj\b|adjective/.test(pos)) {
    pool = [
      {
        en: `A more ${w} approach may reduce conflict between local residents and developers.`,
        zh: `更「${gloss}」的做法或许能减少居民与开发商之间的冲突。`,
      },
      {
        en: `Critics argue that the proposal is too ${w} to work in crowded cities.`,
        zh: `批评者认为该方案过于「${gloss}」，难以在拥挤城市奏效。`,
      },
      {
        en: `Students need ${w} evidence rather than vague personal opinions in Task 2.`,
        zh: `在写作任务二中，学生需要「${gloss}」的证据，而不是含糊的个人看法。`,
      },
    ];
  } else if (/\badv\b|adverb/.test(pos)) {
    pool = [
      {
        en: `The author ${w} links air pollution to higher hospital admissions in the final paragraph.`,
        zh: `作者在末段「${gloss}」地把空气污染与更高的住院率联系起来。`,
      },
      {
        en: `If cities plan housing ${w}, traffic and school places can keep pace with population growth.`,
        zh: `若城市「${gloss}」地规划住房，交通与学位就能跟上人口增长。`,
      },
    ];
  } else {
    // verbs / unknown — frames where base form fits naturally
    pool = [
      {
        en: `From the survey data, the team could ${w} that remote work improved focus for many staff.`,
        zh: `根据调查数据，团队可以「${gloss}」远程办公提升了许多员工的专注度。`,
      },
      {
        en: `Before the vote, several MPs tried to ${w} the discussion with fresh regional evidence.`,
        zh: `投票前，几位议员试图用新的地方证据来「${gloss}」这场讨论。`,
      },
      {
        en: `Critics ${w} that the new law may widen the gap between rich and poor regions.`,
        zh: `批评者「${gloss}」新法可能拉大富裕与贫困地区之间的差距。`,
      },
      {
        en: `In Writing Task 2, candidates often ${w} with a clear position in the opening paragraph.`,
        zh: `在写作任务二中，考生常在开头段用明确立场来「${gloss}」。`,
      },
      {
        en: `Researchers will ${w} the experiment only after reviewing ethical and safety concerns.`,
        zh: `研究人员将在审阅伦理与安全问题后，才「${gloss}」该实验。`,
      },
      {
        en: `Teachers ${w} that small group discussion helps quieter students contribute more.`,
        zh: `教师「${gloss}」小组讨论有助于内向学生更多参与。`,
      },
    ];
  }

  const picked = pool[pickFallbackIndex(w, pool.length)] || pool[0];
  if (mode === 'translate') {
    return { zh: picked.zh, en: picked.en };
  }
  return picked;
}

function sentenceHasWord(sentence: string, word: string): boolean {
  const w = word.trim();
  if (!w || !sentence) return false;
  const esc = escapeReg(w);
  return new RegExp(
    '\\b' + esc + '(?:s|es|ed|ing|ings|er|ers|est|ly|ies|ied)?\\b',
    'i'
  ).test(sentence);
}

/** Chinese prompt must not contain English words (match example.html). */
function chineseIsFullyChinese(text: string, targetWord: string): boolean {
  const s = String(text || '').trim();
  if (!s) return false;
  if (sentenceHasWord(s, targetWord)) return false;
  if (/\b[A-Za-z][A-Za-z'-]+\b/.test(s)) return false;
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
  s = s.replace(/\b[A-Za-z][A-Za-z'-]+\b/g, '').replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/\s+([，。！？、；：])/g, '$1').trim();
  return s || `这句话描述的情境与「${gloss}」有关。`;
}

function practicePromptRules(mode: 'cloze' | 'translate'): string {
  return `Quality rules (strict):
- Write ONE natural IELTS-style sentence in a concrete situation (research, policy, education, environment, work, health, culture, technology).
- The target word must carry real meaning in that situation — the learner should feel a real exam sentence, not a vocabulary tutorial.
- B1–B2 level, clear and idiomatic.
- Different words → different topics/contexts.

FORBIDDEN (these are automatic fails):
- Meta / tutorial lines about learning or "using" the word itself
- Patterns like "It is important to use X accurately", "In academic writing, use X appropriately", "X is a useful word", "This word means..."
- Defining the word inside the sentence
- Listing synonyms or giving usage advice instead of a real example

Good: "From the survey results, the team concluded that remote work improved productivity."
Bad: "In academic writing, it is important to use conclude accurately and appropriately."

${
  mode === 'translate'
    ? `- translateChinese MUST be fully Chinese (no English/Latin words; do not leave the target word in Chinese)
- translateReference MUST contain the exact target word (or a common inflection) as a standalone word`
    : `- clozeEnglish MUST contain the exact target word (or a common inflection) as a standalone word
- clozeChinese MUST be a full Chinese translation (no English/Latin words; do not leave the target word in Chinese)`
}`;
}

/**
 * One LLM request for multiple words (like example.html generateContentBatch).
 * Returns map wordId → { en, zh }.
 */
export async function generatePracticeBatch(
  words: Word[],
  mode: 'cloze' | 'translate',
  settings: Settings
): Promise<Record<string, PracticeSentence>> {
  if (!words.length) return {};

  if (words.length === 1) {
    const w = words[0];
    try {
      const map = await generatePracticeBatchMany(words, mode, settings);
      if (map[w.id] && !isLazyMetaSentence(map[w.id].en, w.word)) return map;
    } catch {
      /* fallback below */
    }
    // one extra single-item retry with stronger reminder
    try {
      const map = await generatePracticeBatchMany(words, mode, settings, true);
      if (map[w.id] && !isLazyMetaSentence(map[w.id].en, w.word)) return map;
    } catch {
      /* fallback below */
    }
    return { [w.id]: fallbackPracticeSentence(w, mode) };
  }

  try {
    const map = await generatePracticeBatchMany(words, mode, settings);
    for (const w of words) {
      if (!map[w.id] || isLazyMetaSentence(map[w.id].en, w.word)) {
        map[w.id] = fallbackPracticeSentence(w, mode);
      }
    }
    return map;
  } catch {
    const result: Record<string, PracticeSentence> = {};
    for (const w of words) {
      result[w.id] = fallbackPracticeSentence(w, mode);
    }
    return result;
  }
}

async function generatePracticeBatchMany(
  words: Word[],
  mode: 'cloze' | 'translate',
  settings: Settings,
  reinforce = false
): Promise<Record<string, PracticeSentence>> {
  const hints = words.map((w) => wordHintLine(w)).join('\n- ');
  const reinforceBlock = reinforce
    ? `\nIMPORTANT RETRY: Previous output was rejected as lazy/meta. Do NOT write about "using the word". Write a real situational sentence.\n`
    : '';

  const prompt =
    mode === 'translate'
      ? `You are an English vocabulary tutor for an IELTS test taker.
${reinforceBlock}
Create a Chinese-to-English translation exercise for EACH target word below:
- ${hints}

${practicePromptRules('translate')}

Return JSON EXACTLY:
{
  "items": [
    {"word": "example", "translateChinese": "...", "translateReference": "..."}
  ]
}
Include exactly one item per word, using the same spelling as given.`
      : `You are an English vocabulary tutor for an IELTS test taker.
${reinforceBlock}
Create a cloze (fill-in-the-blank) exercise for EACH target word below:
- ${hints}

${practicePromptRules('cloze')}

Return JSON EXACTLY:
{
  "items": [
    {"word": "example", "clozeEnglish": "...", "clozeChinese": "..."}
  ]
}
Include exactly one item per word, using the same spelling as given.`;

  const text = await callLLM([{ role: 'user', content: prompt }], settings, {
    temperature: reinforce ? 0.9 : 0.85,
    jsonMode: true,
  });

  let parsed: { items?: Array<Record<string, string>> };
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }

  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const byWord: Record<string, Record<string, string>> = {};
  for (const it of items) {
    if (it?.word) byWord[String(it.word).toLowerCase()] = it;
  }

  const result: Record<string, PracticeSentence> = {};
  for (const w of words) {
    const raw = byWord[w.word.toLowerCase()];
    if (!raw) continue;
    if (mode === 'translate') {
      let zh = String(raw.translateChinese || '').trim();
      const en = String(raw.translateReference || '').trim();
      if (!zh || !en || !sentenceHasWord(en, w.word)) continue;
      if (isLazyMetaSentence(en, w.word)) continue;
      if (!chineseIsFullyChinese(zh, w.word)) zh = sanitizeChinese(zh, w);
      result[w.id] = { zh, en };
    } else {
      const en = String(raw.clozeEnglish || '').trim();
      let zh = String(raw.clozeChinese || '').trim();
      if (!zh || !en || !sentenceHasWord(en, w.word)) continue;
      if (isLazyMetaSentence(en, w.word)) continue;
      if (!chineseIsFullyChinese(zh, w.word)) zh = sanitizeChinese(zh, w);
      result[w.id] = { en, zh };
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
