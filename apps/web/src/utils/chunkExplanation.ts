/** 搭配本 AI 解释 — 结构化数据 ↔ Markdown 展示 */

export interface ChunkExplanationParts {
  summary: string;
  coreMeanings: string;
  phoneticUk?: string;
  phoneticUs?: string;
  grammar?: string;
  exampleEn: string;
  exampleZh?: string;
  notes?: string;
  gloss: string;
}

export function formatChunkExplanation(
  phrase: string,
  parts: ChunkExplanationParts
): string {
  const lines: string[] = [];
  const head = parts.summary.trim();
  if (head) {
    lines.push(head.startsWith(phrase) ? head : `${phrase.trim()} ${head}`);
  } else {
    lines.push(`${phrase.trim()}：${parts.coreMeanings || parts.gloss}`);
  }
  lines.push('');
  if (parts.coreMeanings) {
    lines.push(`- **核心释义：** ${parts.coreMeanings}`);
  }
  if (parts.phoneticUk || parts.phoneticUs) {
    const uk = parts.phoneticUk || '—';
    const us = parts.phoneticUs || '—';
    lines.push(`- **发音：** 英 ${uk} / 美 ${us}`);
  }
  if (parts.grammar) {
    lines.push(`- **语法结构：** ${parts.grammar}`);
  }
  if (parts.exampleEn) {
    const zh = parts.exampleZh ? `（${parts.exampleZh}）` : '';
    lines.push(`- **典型例句：** ${parts.exampleEn}${zh}`);
  }
  if (parts.notes?.trim()) {
    lines.push('', parts.notes.trim());
  }
  return lines.join('\n').trim();
}

/** 有道仅有释义时，生成简短说明 */
export function formatYoudaoExplanation(phrase: string, gloss: string): string {
  return formatChunkExplanation(phrase, {
    summary: `意为「${gloss}」`,
    coreMeanings: gloss,
    exampleEn: '',
    gloss,
  });
}
