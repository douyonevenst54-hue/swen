/**
 * Device-side encryption with WebCrypto.
 *
 * - The server gives each device one random AES-256 data key, released only
 *   after a correct staff PIN (online).
 * - The device stores that key wrapped with a key derived from each staff
 *   member's PIN (PBKDF2-SHA256), so later unlocks work offline. A wrong PIN
 *   simply fails to unwrap.
 * - Patient identity fields and the sync session token are encrypted with the
 *   data key. The key itself only lives in memory while someone is logged in.
 */
import type { Sealed, WrappedKey } from "./db";

const PBKDF2_ITERATIONS = 310_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const u8 = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

function random(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

async function pinKey(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Import the raw data key for use; non-extractable once imported. */
export async function importDataKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error("Data key must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function wrapDataKey(raw: Uint8Array<ArrayBuffer>, pin: string, iterations = PBKDF2_ITERATIONS): Promise<WrappedKey> {
  const salt = random(16);
  const iv = random(12);
  const key = await pinKey(pin, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, raw);
  return { salt: toB64(salt), iv: toB64(iv), ct: toB64(ct), iterations, wrappedAt: new Date().toISOString() };
}

/** Returns the data key, or null if the PIN is wrong. */
export async function unwrapDataKey(wrapped: WrappedKey, pin: string): Promise<CryptoKey | null> {
  try {
    const key = await pinKey(pin, fromB64(wrapped.salt), wrapped.iterations);
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(wrapped.iv) }, key, fromB64(wrapped.ct)));
    return importDataKey(raw);
  } catch {
    return null;
  }
}

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = random(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function open<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(sealed.iv) }, key, fromB64(sealed.ct));
  return JSON.parse(dec.decode(pt)) as T;
}
