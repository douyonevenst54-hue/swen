import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

/** Random URL-safe token (256 bits). */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored only as SHA-256 hashes; a database leak does not leak usable tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Human-friendly setup code: 8 characters without look-alike letters, shown as XXXX-XXXX. */
export function newSetupCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[randomInt(alphabet.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normalizeSetupCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");
}

// ---- PINs (scrypt) -----------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pin, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(pin, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isValidPin(pin: string): boolean {
  // 6+ digits: a stolen tablet holds a PIN-wrapped key that can be attacked offline.
  return /^\d{6,8}$/.test(pin);
}

// ---- Device data keys (AES-256-GCM envelope) --------------------------------

export function newDataKey(): Buffer {
  return randomBytes(32);
}

export function sealKey(dataKey: Buffer, kek: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ct = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return ["v1", iv.toString("base64"), ct.toString("base64"), cipher.getAuthTag().toString("base64")].join(".");
}

export function openKey(sealed: string, kek: Buffer): Buffer {
  const [v, ivB64, ctB64, tagB64] = sealed.split(".");
  if (v !== "v1" || !ivB64 || !ctB64 || !tagB64) throw new Error("Unknown sealed key format");
  const decipher = createDecipheriv("aes-256-gcm", kek, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
}

// ---- Signed values (dashboard cookie) ---------------------------------------

export function sign(value: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}.${mac}`;
}

export function unsign(signed: string, secret: string): string | null {
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const mac = Buffer.from(signed.slice(i + 1));
  const expected = Buffer.from(createHmac("sha256", secret).update(value).digest("base64url"));
  return mac.length === expected.length && timingSafeEqual(mac, expected) ? value : null;
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
