import { json, preflight } from "@/lib/http";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

/** Lets the field app check reachability and correct its clock without auth. */
export async function GET() {
  return json({ ok: true, serverTime: new Date().toISOString() });
}
