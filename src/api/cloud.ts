/**
 * Cloud sync v2.12 — POST/GET base64 gzipped JSON via Worker.
 *
 * Push: gzip JSON → base64 → POST /api/upload { data }
 * Pull: GET /api/download → { data: base64 } → ungzip JSON
 *
 * Payload may be compact patches (v3) or legacy full words[].
 */

import { gzip, ungzip } from 'pako';
import type { Settings } from '@/types/settings';
import type { Word } from '@/types/word';
import type { CustomWordSync, WordSyncPatch } from '@/utils/wordSyncPatch';

export interface SyncPayload {
  /** 3 = compact patches (notes / lexis edits / SRS only) */
  v?: number;
  /** @deprecated legacy full word dump; pull still merges as overlays */
  words?: Word[];
  patches?: WordSyncPatch[];
  custom?: CustomWordSync[];
  customCategories?: string[];
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function payloadToJson(payload: SyncPayload): string {
  return JSON.stringify({
    v: payload.v || 3,
    patches: payload.patches || [],
    custom: payload.custom || [],
    customCategories: payload.customCategories || [],
    words: payload.words || [],
    state: payload.state || {},
    meta: { ...(payload.meta || {}), lastSyncAt: Date.now() },
    encrypted: payload.encrypted || null,
  });
}

/** 推：gzip → base64 → POST /api/upload */
export async function uploadAll(
  settings: Settings,
  username: string,
  payload: SyncPayload
): Promise<void> {
  if (!settings.workerUrl) throw new CloudError('未设置 Worker URL', 0);

  const gz = gzip(payloadToJson(payload));
  const b64 = bytesToBase64(gz);

  const resp = await fetch(getBase(settings.workerUrl) + '/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(settings, username),
    },
    body: JSON.stringify({ data: b64 }),
  });
  const data = await readJsonSafe(resp);
  if (!resp.ok) {
    throw new CloudError(String(data.error || `上传失败: ${resp.status}`), resp.status);
  }
}

/** 拉：GET /api/download → base64 → ungzip */
export async function downloadAll(
  settings: Settings,
  username: string
): Promise<SyncPayload | null> {
  if (!settings.workerUrl) return null;

  try {
    const resp = await fetch(getBase(settings.workerUrl) + '/api/download', {
      headers: authHeaders(settings, username),
    });
    if (!resp.ok) return null;
    const body = await readJsonSafe(resp);
    const b64 = typeof body.data === 'string' ? body.data : '';
    if (!b64) return null;

    const text = ungzip(base64ToBytes(b64), { toText: true });
    return JSON.parse(text) as SyncPayload;
  } catch {
    return null;
  }
}

/** 备份元信息 */
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

/** Aliases matching FRONTEND_MIGRATION_V2 naming */
export const pushAll = uploadAll;
export const fetchAll = downloadAll;
