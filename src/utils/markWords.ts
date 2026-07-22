/** Common English words that should not be offered as vocab-to-add. */

export const MARK_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'onto', 'to', 'with', 'without',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'done', 'have', 'has', 'had', 'having',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'need', 'dare',
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'we', 'us', 'our', 'ours', 'they', 'them', 'their', 'theirs',
  'this', 'that', 'these', 'those', 'there', 'here', 'then', 'than', 'so', 'such', 'very', 'too', 'also', 'just', 'only', 'even', 'still',
  'not', 'no', 'nor', 'yes', 'all', 'any', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'own', 'same',
  'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  'about', 'above', 'after', 'again', 'against', 'along', 'among', 'around', 'before', 'behind', 'below', 'between', 'during', 'over', 'through', 'under', 'until', 'upon', 'within',
  'up', 'down', 'out', 'off', 'further', 'once', 'twice',
  'one', 'two', 'three', 'first', 'second', 'third',
]);

export function normalizeMarkWord(raw: string): string {
  return String(raw || '').toLowerCase().replace(/[^a-z'-]/g, '');
}

export function isMarkableToken(token: string): boolean {
  const lower = normalizeMarkWord(token);
  return lower.length >= 3 && !MARK_STOPWORDS.has(lower);
}
