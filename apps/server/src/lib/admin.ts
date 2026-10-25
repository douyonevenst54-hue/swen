import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sign } from "./crypto";
import { env } from "./env";
import { ADMIN_COOKIE_NAME, verifyAdminCookieEdge } from "./admin-cookie";

export const ADMIN_COOKIE = ADMIN_COOKIE_NAME;
export const ADMIN_SESSION_HOURS = 12;

export function makeAdminCookieValue(now = Date.now()): string {
  return sign(`admin:${now + ADMIN_SESSION_HOURS * 3600_000}`, env.sessionSecret);
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifyAdminCookieEdge(jar.get(ADMIN_COOKIE)?.value, env.sessionSecret);
}

/** Call at the top of every dashboard page and server action. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/login");
}
