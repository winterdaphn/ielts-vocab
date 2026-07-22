/**
 * Crypto helpers — PBKDF2 + AES-GCM, matching the original single-file implementation.
 * - PBKDF2 with username in salt → different keys for different users
 * - AES-GCM 256-bit
 * - cachedKey is per-(username, password) to avoid re-derivation
 */

let _cachedKey: CryptoKey | null = null;
let _cachedKeyKey = '';

const PBKDF2_ITERATIONS = 120_000;

export function arrayToBase64(arr: ArrayBuffer | Uint8Array): string {
  const bytes = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function base64ToArray(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, saltBytes: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  // Copy to fresh ArrayBuffer (TS 5.6+ is strict about SharedArrayBuffer)
  const saltBuf = new Uint8Array(saltBytes).buffer;
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuf, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function getCryptoKey(password: string, username: string): Promise<CryptoKey> {
  const cacheKey = (username || '') + ':' + password;
  if (_cachedKey && _cachedKeyKey === cacheKey) return _cachedKey;
  const saltStr = 'ielts-vocab-enc-salt-v2:' + (username || 'default');
  const salt = new TextEncoder().encode(saltStr);
  _cachedKey = await deriveKey(password, salt);
  _cachedKeyKey = cacheKey;
  return _cachedKey;
}

export function clearCryptoCache() {
  _cachedKey = null;
  _cachedKeyKey = '';
}

export interface EncryptedPayload {
  iv: string;
  data: string;
}

export async function encryptJSON(value: unknown, password: string, username: string): Promise<EncryptedPayload> {
  const key = await getCryptoKey(password, username);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(iv).buffer }, key, plaintext);
  return {
    iv: arrayToBase64(iv),
    data: arrayToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptJSON<T = unknown>(payload: EncryptedPayload, password: string, username: string): Promise<T> {
  const key = await getCryptoKey(password, username);
  const iv = base64ToArray(payload.iv);
  const ciphertext = base64ToArray(payload.data);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
