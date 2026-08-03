/**
 * Cloud sync v2.6 — direct COS upload/download (bypass Worker 1MB limit).
 *
 * Push: POST /api/upload-url → gzip JSON → PUT to COS
 * Pull: GET  /api/download-url → GET COS → ungzip JSON
 */

import { gzip, ungzip } from 'pako';
import type { Settings } from '@/types/settings';
import type { Word } from '@/types/word';

export interface SyncPayload {
  words: Word[];
  state: Record<string, unknown>;
  meta?: Record<string, unknown>;
  encrypted?: { iv: string; data: string; v?: number } | null;
}

export class CloudError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getBase(url: string): string {
  return url.replace(/\/$/, '');
}

function authHeaders(settings: Settings, username: string): Record<string, string> {
  const h: Record<string, string> = {};
  if (settings.syncToken) h['X-Auth-Token'] = settings.syncToken;
  if (username) h['X-Profile'] = username;
  return h;
}

async function readJsonSafe(resp: Response): Promise<Record<string, unknown>> {
  try {
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 推：拿预签名 URL → gzip → PUT 到 COS */
export async function uploadAll(
  settings: Settings,
  username: string,
  payload: SyncPayload
): Promise<void> {
  if (!settings.workerUrl) throw new CloudError('未设置 Worker URL', 0);

  const signResp = await fetch(getBase(settings.workerUrl) + '/api/upload-url', {
    method: 'POST',
    headers: authHeaders(settings, username),
  });
  const signData = await readJsonSafe(signResp);
  if (!signResp.ok) {
    throw new CloudError(
      String(signData.error || '获取上传地址失败'),
      signResp.status
    );
  }
  const url = String(signData.url || '');
  const cosHeaders = (signData.headers || {}) as Record<string, string>;
  if (!url) throw new CloudError('上传地址为空', 0);

  const json = JSON.stringify({
    words: payload.words || [],
    state: payload.state || {},
    meta: { ...(payload.meta || {}), lastSyncAt: Date.now() },
    encrypted: payload.encrypted || null,
  });
  const gz = gzip(json);
  const put = await fetch(url, {
    method: 'PUT',
    body: gz,
    headers: cosHeaders,
  });
  if (!put.ok) {
    throw new CloudError(`COS 上传失败: ${put.status}`, put.status);
  }
}

/** 拉：拿预签名 URL → GET COS → 解压 */
export async function downloadAll(
  settings: Settings,
  username: string
): Promise<SyncPayload | null> {
  if (!settings.workerUrl) return null;

  try {
    const signResp = await fetch(
      getBase(settings.workerUrl) + '/api/download-url',
      { headers: authHeaders(settings, username) }
    );
    if (!signResp.ok) return null;
    const signData = await readJsonSafe(signResp);
    if (!signData.hasBackup) return null;
    const url = String(signData.url || '');
    if (!url) return null;

    const buf = await (await fetch(url)).arrayBuffer();
    const text = ungzip(new Uint8Array(buf), { toText: true });
    return JSON.parse(text) as SyncPayload;
  } catch {
    return null;
  }
}

/** 备份元信息（可选） */
export async function getInfo(
  settings: Settings,
  username: string
): Promise<{ hasBackup?: boolean; [k: string]: unknown }> {
  if (!settings.workerUrl) return { hasBackup: false };
  try {
    const resp = await fetch(getBase(settings.workerUrl) + '/api/info', {
      headers: authHeaders(settings, username),
    });
    if (!resp.ok) return { hasBackup: false };
    return await readJsonSafe(resp);
  } catch {
    return { hasBackup: false };
  }
}

/** Aliases matching FRONTEND_MIGRATION.md naming */
export const pushAll = uploadAll;
export const fetchAll = downloadAll;
