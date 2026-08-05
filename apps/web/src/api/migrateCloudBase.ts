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
  // 导入过程可能改 settings；务必保住登录后的 JWT
  const jwt = settings.syncToken;

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

  useSettings.getState().update({ syncToken: jwt });

  // Ensure store mirrors Dexie after merge
  const userId = useAuth.getState().username;
  if (userId) {
    const rows = await db.words.where('userId').equals(userId).toArray();
    useWordsStore.getState().setWords(rows as never);
  }

  const localCount = userId
    ? await db.words.where('userId').equals(userId).count()
    : useWordsStore.getState().words.length;

  let uploaded = 0;
  try {
    uploaded = await pushAllWordsNow();
  } catch (e) {
    throw new Error(
      '本机已合并 CloudBase，但上传到新服务器失败：' +
        (e instanceof Error ? e.message : '未知错误') +
        '。请点「立即同步」重试，否则换设备看不到进度。'
    );
  }

  if (localCount > 0 && uploaded === 0) {
    throw new Error(
      `本机有 ${localCount} 个词，但上传数为 0。请检查登录状态后点「立即同步」，否则换设备会是空的。`
    );
  }

  return {
    added: applied.added,
    patched: applied.patched,
    uploaded,
    needsPassword: applied.needsPassword,
    practiceRestored: applied.practiceRestored,
  };
}
