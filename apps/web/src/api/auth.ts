/**
 * Auth API — login, register, hash password.
 * Password is hashed locally before sending — server never sees plaintext.
 * Successful auth returns JWT stored as settings.syncToken.
 */

import { arrayToBase64, sha256Bytes } from './crypto';
import { useSettings } from '@/store/useSettings';

const USERNAME_RE = /^[\u4e00-\u9fa5a-zA-Z0-9_\-]+$/;

export function sanitizeUsername(u: string): string {
  if (!u || typeof u !== 'string') return '';
  return u.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_').slice(0, 32);
}

export function isValidUsername(u: string): boolean {
  return USERNAME_RE.test(u) && u.length > 0 && u.length <= 32;
}

export async function hashAuthPassword(password: string, username: string): Promise<string> {
  // SHA-256 of "auth:{username}:{password}", truncated to 16 bytes
  // Uses pure-JS fallback on http://IP (crypto.subtle only on https/localhost)
  const enc = new TextEncoder();
  const data = enc.encode('auth:' + username + ':' + password);
  const hash = await sha256Bytes(data);
  return arrayToBase64(hash.slice(0, 16));
}

export class AuthError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getBaseUrl(workerUrl: string): string {
  return workerUrl.replace(/\/$/, '');
}

export interface AuthResult {
  ok: true;
  username: string;
  token: string;
  createdAt?: number;
}

function persistToken(token: string | undefined) {
  if (token) useSettings.getState().update({ syncToken: token });
}

export async function authRegister(
  username: string,
  password: string,
  workerUrl: string
): Promise<AuthResult> {
  const authHash = await hashAuthPassword(password, username);
  const resp = await fetch(getBaseUrl(workerUrl) + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, authHash }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new AuthError(data.error || '注册失败', resp.status, data.error);
  }
  persistToken(data.token);
  return data;
}

export async function authLogin(
  username: string,
  password: string,
  workerUrl: string
): Promise<AuthResult> {
  const authHash = await hashAuthPassword(password, username);
  const resp = await fetch(getBaseUrl(workerUrl) + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, authHash }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new AuthError(data.error || '登录失败', resp.status, data.error);
  }
  persistToken(data.token);
  return data;
}
