import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See apps/server/.env.example.`);
  return v;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  /** Password for the supervisor dashboard. */
  get adminPassword() {
    return required("ADMIN_PASSWORD");
  },
  /** Secret for signing dashboard session cookies (32+ random bytes). */
  get sessionSecret() {
    const s = required("SESSION_SECRET");
    if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
    return s;
  },
  /** Base64 32-byte key that encrypts each device's data key at rest. */
  get keyEncryptionKey(): Buffer {
    const k = Buffer.from(required("KEY_ENCRYPTION_KEY"), "base64");
    if (k.length !== 32) throw new Error("KEY_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    return k;
  },
  get staffSessionDays(): number {
    const n = Number(process.env.STAFF_SESSION_DAYS ?? 7);
    return Number.isFinite(n) && n > 0 ? n : 7;
  },
};
