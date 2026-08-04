/**
 * Legacy CloudBase pull — X-Profile / X-Auth-Token, GET /api/download
 */
import { ungzip } from 'pako';
import type { SyncPayload } from '@/api/cloud';
import { cloudbasePullViaApi } from '@/api/wordsApi';
import type { Settings } from '@/types/settings';

export const DEFAULT_CLOUDBASE_URL =
  'https://ielts-vocab-d5gu0dfe9e1a9b5e9-1257115199.ap-shanghai.app.tcloudbase.com/vocab-api';

function getBase(url: string): string {
  return url.replace(/\/$/, '');
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodePayload(b64: string): SyncPayload | null {
  if (!b64) return null;
  try {
    const text = ungzip(base64ToBytes(b64), { toText: true });
    return JSON.parse(text) as SyncPayload;
  } catch {
    return null;
  }
}

/** Direct browser → CloudBase download */
export async function downloadFromCloudBase(
  cloudbaseUrl: string,
  username: string,
  legacyToken?: string
): Promise<SyncPayload | null> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (username) headers['X-Profile'] = username;
  if (legacyToken) headers['X-Auth-Token'] = legacyToken;

  const resp = await fetch(getBase(cloudbaseUrl) + '/api/download', { headers });
  if (!resp.ok) {
    throw new Error(`CloudBase 拉取失败 HTTP ${resp.status}`);
  }
  const body = (await resp.json().catch(() => ({}))) as { data?: string };
  return decodePayload(typeof body.data === 'string' ? body.data : '');
}

/**
 * Try direct pull; on CORS/network failure, use new API proxy.
 */
export async function downloadCloudBaseWithFallback(
  settings: Settings,
  cloudbaseUrl: string,
  username: string,
  legacyToken?: string
): Promise<SyncPayload | null> {
  try {
    return await downloadFromCloudBase(cloudbaseUrl, username, legacyToken);
  } catch (e) {
    console.warn('CloudBase direct pull failed, trying API proxy', e);
    if (!settings.syncToken) throw e;
    const b64 = await cloudbasePullViaApi(
      settings,
      cloudbaseUrl,
      username,
      legacyToken
    );
    return decodePayload(b64);
  }
}
