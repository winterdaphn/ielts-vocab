/**
 * Cloud sync — read/write vocab data to CloudBase.
 * Per-user: X-Profile header routes to vocab_data_<username> doc.
 */

import type { Settings } from '@/types/settings';
import type { Word } from '@/types/word';

export interface SyncPayload {
  words: Word[];
  state: Record<string, unknown>;
  meta?: Record<string, unknown>;
  encrypted?: { iv: string; data: string; v?: number } | null;
}

function getBaseUrl(workerUrl: string): string {
  return workerUrl.replace(/\/$/, '');
}

function buildHeaders(settings: Settings, username: string): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.syncToken) headers['X-Auth-Token'] = settings.syncToken;
  if (username) headers['X-Profile'] = username;
  return headers;
}

export class CloudError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function fetchAll(settings: Settings, username: string): Promise<SyncPayload | null> {
  if (!settings.workerUrl) return null;
  try {
    const resp = await fetch(getBaseUrl(settings.workerUrl) + '/api/all', {
      method: 'GET',
      headers: buildHeaders(settings, username),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function pushAll(
  settings: Settings,
  username: string,
  payload: SyncPayload
): Promise<void> {
  if (!settings.workerUrl) throw new CloudError('未设置 Worker URL', 0);
  const resp = await fetch(getBaseUrl(settings.workerUrl) + '/api/all', {
    method: 'POST',
    headers: buildHeaders(settings, username),
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new CloudError(data.error || '推送失败', resp.status);
  }
}
