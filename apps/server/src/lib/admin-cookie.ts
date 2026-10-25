/** Cookie check used by proxy.ts (no Next server-only imports). */
import { unsign } from "./crypto";

export const ADMIN_COOKIE_NAME = "swen_admin";

export function verifyAdminCookieEdge(value: string | undefined, secret: string, now = Date.now()): boolean {
  if (!value || secret.length < 32) return false;
  const inner = unsign(value, secret);
  if (!inner?.startsWith("admin:")) return false;
  const expires = Number(inner.slice(6));
  return Number.isFinite(expires) && expires > now;
}
