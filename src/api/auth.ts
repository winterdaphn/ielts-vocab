/**
 * Auth API — login, register, hash password.
 * Password is hashed locally before sending — server never sees plaintext.
 */

import { arrayToBase64 } from './crypto';

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
  const enc = new TextEncoder();
  const data = enc.encode('auth:' + username + ':' + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return arrayToBase64(new Uint8Array(hash).slice(0, 16));
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

export interface RegisterResult {
  ok: true;
  username: string;
}

export async function authRegister(
  username: string,
  password: string,
  workerUrl: string
): Promise<RegisterResult> {
  if (!workerUrl) throw new AuthError('请先设置 Worker URL', 0, 'no_url');
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
  return data;
}

export interface LoginResult {
  ok: true;
  username: string;
  createdAt: number;
}

export async function authLogin(
  username: string,
  password: string,
  workerUrl: string
): Promise<LoginResult> {
  if (!workerUrl) throw new AuthError('请先设置 Worker URL', 0, 'no_url');
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
  return data;
}
