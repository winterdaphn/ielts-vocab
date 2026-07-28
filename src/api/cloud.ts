/**
 * Cloud sync — read/write vocab data via Worker cloud storage (gzip + base64).
 * Per-user: X-Profile header routes to that user's backup file.
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

function getBaseUrl(workerUrl: string): string {
  return workerUrl.replace(/\/$/, '');
}

function authHeaders(settings: Settings, username: string): Record<string, string> {
  const headers: Record<string, string> = {};
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

/** Avoid stack overflow on large Uint8Array (1–5MB payloads). */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function uploadAll(
  settings: Settings,
  username: string,
  payload: SyncPayload
): Promise<void> {
  if (!settings.workerUrl) throw new CloudError('未设置 Worker URL', 0);
  const json = JSON.stringify({
    words: payload.words,
    state: payload.state,
    meta: payload.meta,
    encrypted: payload.encrypted,
  });
  const compressed = gzip(json);
  const base64 = uint8ToBase64(compressed);
  const resp = await fetch(getBaseUrl(settings.workerUrl) + '/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(settings, username),
    },
    body: JSON.stringify({ data: base64 }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new CloudError(data.error || '上传失败', resp.status);
  }
}

export async function downloadAll(
  settings: Settings,
  username: string
): Promise<SyncPayload | null> {
  if (!settings.workerUrl) return null;
  try {
    const resp = await fetch(getBaseUrl(settings.workerUrl) + '/api/download', {
      method: 'GET',
      headers: authHeaders(settings, username),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.hasBackup) return null;
    const compressed = base64ToUint8(data.data);
    const json = ungzip(compressed, { toText: true });
    return JSON.parse(json) as SyncPayload;
  } catch {
    return null;
  }
}

/** Alias for compatibility — new code prefers downloadAll / uploadAll */
export const fetchAll = downloadAll;
export const pushAll = uploadAll;
