/**
 * CloudBase → Dexie → relational batch upload
 */
import {
  DEFAULT_CLOUDBASE_URL,
  downloadCloudBaseWithFallback,
} from '@/api/cloudbaseLegacy';
import { applySyncPayload } from '@/api/sync';
import { pushAllWordsNow, withSyncSuspended } from '@/api/realtimeSync';
import { useSettings } from '@/store/useSettings';
import { useWordsStore } from '@/store/useWords';
import { db } from '@/db/ieltsDb';
import { useAuth } from '@/store/useAuth';

export { DEFAULT_CLOUDBASE_URL };

export interface CloudBaseImportResult {
  added: number;
  patched: number;
  uploaded: number;
  needsPassword: boolean;
  practiceRestored: boolean;
}

export async function importFromCloudBase(opts: {
  cloudbaseUrl: string;
  legacyToken?: string;
  password: string;
  username: string;
}): Promise<CloudBaseImportResult> {
  const settings = useSettings.getState();
  if (!settings.syncToken) {
    throw new Error('请先登录新服务器以获取 JWT');
  }

  const payload = await downloadCloudBaseWithFallback(
    settings,
    opts.cloudbaseUrl || DEFAULT_CLOUDBASE_URL,
    opts.username,
    opts.legacyToken
  );
  if (!payload) {
    throw new Error('CloudBase 没有可导入的数据');
  }

  const applied = await withSyncSuspended(() =>
    applySyncPayload(payload, opts.password, opts.username)
  );

  // Ensure store mirrors Dexie after merge
  const userId = useAuth.getState().username;
  if (userId) {
    const rows = await db.words.where('userId').equals(userId).toArray();
    useWordsStore.getState().setWords(rows as never);
  }

  const uploaded = await pushAllWordsNow();
  return {
    added: applied.added,
    patched: applied.patched,
    uploaded,
    needsPassword: applied.needsPassword,
    practiceRestored: applied.practiceRestored,
  };
}
