import { db, type WordRow } from '@/db/ieltsDb';
import {
  isLegacyWordUuid,
  mergeWordRecords,
  wordToId,
  withCanonicalWordId,
} from '@/utils/wordId';
import type { SavedPracticeSession } from '@/utils/practiceSession';

const MIGRATION_FLAG = 'word-id-lemma-v1';

function migrationFlagKey(userId: string): string {
  return `ielts-${userId}-${MIGRATION_FLAG}`;
}

function remapPracticeSession(userId: string, idMap: Map<string, string>): void {
  if (idMap.size === 0) return;
  const key = `ielts-${userId}-practice-session`;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as SavedPracticeSession;
    if (!saved?.wordIds?.length) return;
    let changed = false;
    const wordIds = saved.wordIds.map((oldId) => {
      const next = idMap.get(oldId) || oldId;
      if (next !== oldId) changed = true;
      return next;
    });
    const examples: Record<string, SavedPracticeSession['examples'][string]> = {};
    if (saved.examples) {
      for (const [k, ex] of Object.entries(saved.examples)) {
        const nk = idMap.get(k) || k;
        if (nk !== k) changed = true;
        if (!examples[nk]) examples[nk] = ex;
      }
    }
    if (!changed) return;
    saved.wordIds = wordIds;
    saved.examples = examples;
    localStorage.setItem(key, JSON.stringify(saved));
  } catch {
    /* ignore corrupt session */
  }
}

/**
 * One-time per user: UUID ids → lemma ids; dedupe same lemma; remap practice session.
 */
export async function migrateUserWordIdsIfNeeded(userId: string): Promise<void> {
  if (!userId) return;
  try {
    if (localStorage.getItem(migrationFlagKey(userId)) === '1') return;
  } catch {
    return;
  }

  const rows = await db.words.where('userId').equals(userId).toArray();
  if (!rows.length) {
    try {
      localStorage.setItem(migrationFlagKey(userId), '1');
    } catch {
      /* ignore */
    }
    return;
  }

  const needsWork = rows.some(
    (r) => r.id !== wordToId(r.word) || isLegacyWordUuid(r.id)
  );
  const byLemma = new Map<string, WordRow[]>();
  for (const row of rows) {
    const canon = wordToId(row.word);
    if (!canon) continue;
    const list = byLemma.get(canon) || [];
    list.push(row);
    byLemma.set(canon, list);
  }
  const hasDupes = [...byLemma.values()].some((g) => g.length > 1);
  if (!needsWork && !hasDupes) {
    try {
      localStorage.setItem(migrationFlagKey(userId), '1');
    } catch {
      /* ignore */
    }
    return;
  }

  const idMap = new Map<string, string>();
  const toPut: WordRow[] = [];
  const toDelete = new Set<string>();

  for (const [canon, group] of byLemma) {
    let merged = group[0];
    for (let i = 1; i < group.length; i++) {
      merged = { ...mergeWordRecords(merged, group[i]), userId } as WordRow;
    }
    merged = withCanonicalWordId(merged);
    merged = { ...merged, id: canon, userId };
    toPut.push(merged);
    for (const g of group) {
      idMap.set(g.id, canon);
      if (g.id !== canon) toDelete.add(g.id);
    }
  }

  await db.transaction('rw', db.words, async () => {
    for (const id of toDelete) {
      await db.words.delete(id);
    }
    if (toPut.length) await db.words.bulkPut(toPut);
  });

  remapPracticeSession(userId, idMap);

  try {
    localStorage.setItem(migrationFlagKey(userId), '1');
  } catch {
    /* ignore */
  }
}

/** Match saved practice word id to current list (lemma ids). */
export function resolveSessionWordId(
  savedId: string,
  words: { id: string; word: string }[]
): string | null {
  const direct = words.find((w) => w.id === savedId);
  if (direct) return direct.id;
  const key = wordToId(savedId);
  if (!key) return null;
  const byLemma = words.find((w) => wordToId(w.word) === key);
  return byLemma?.id ?? null;
}
