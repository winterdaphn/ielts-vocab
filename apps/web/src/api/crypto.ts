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
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function base64ToArray(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** true on https / localhost; false on plain http://IP (subtle unavailable) */
export function hasSubtleCrypto(): boolean {
  return typeof globalThis.crypto !== 'undefined' && !!globalThis.crypto.subtle;
}

/** Pure JS SHA-256 (for HTTP non-secure contexts where subtle is missing). */
function sha256Fallback(data: Uint8Array): Uint8Array {
  // Minimal SHA-256 — enough for authHash; not used for AES
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const bitLen = data.length * 8;
  const withPad = new Uint8Array(((data.length + 9 + 63) & ~63));
  withPad.set(data);
  withPad[data.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, bitLen >>> 0, false);
  // high 32 bits of length (always 0 for our short auth strings)
  view.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  for (let i = 0; i < withPad.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15]!, 7) ^ rotr(w[j - 15]!, 18) ^ (w[j - 15]! >>> 3);
      const s1 = rotr(w[j - 2]!, 17) ^ rotr(w[j - 2]!, 19) ^ (w[j - 2]! >>> 10);
      w[j] = (w[j - 16]! + s0 + w[j - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const t1 = (h! + S1 + ch + K[j]! + w[j]!) >>> 0;
      const S0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
      const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a!) >>> 0;
    H[1] = (H[1]! + b!) >>> 0;
    H[2] = (H[2]! + c!) >>> 0;
    H[3] = (H[3]! + d!) >>> 0;
    H[4] = (H[4]! + e!) >>> 0;
    H[5] = (H[5]! + f!) >>> 0;
    H[6] = (H[6]! + g!) >>> 0;
    H[7] = (H[7]! + h!) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, H[i]!, false);
  return out;
}

/** SHA-256 bytes; works on HTTP via fallback when subtle is unavailable. */
export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  if (hasSubtleCrypto()) {
    const buf = new Uint8Array(data).buffer;
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return new Uint8Array(hash);
  }
  return sha256Fallback(data);
}

async function deriveKey(password: string, saltBytes: Uint8Array): Promise<CryptoKey> {
  if (!hasSubtleCrypto()) {
    throw new Error('当前为非安全上下文（HTTP），无法加解密配置。请使用 HTTPS 或 localhost。');
  }
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
