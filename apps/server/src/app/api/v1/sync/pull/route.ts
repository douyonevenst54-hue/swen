import { db } from "@/lib/db";
import { authenticateSync } from "@/lib/device-auth";
import { handle, json, preflight } from "@/lib/http";
import { pullChanges, PULL_LIMIT } from "@/lib/sync";

export const OPTIONS = preflight;

export const GET = handle(async (req) => {
  const { device } = await authenticateSync(db(), req);
  const url = new URL(req.url);
  const limit = Math.min(PULL_LIMIT, Math.max(1, Number(url.searchParams.get("limit")) || PULL_LIMIT));
  return json(await pullChanges(db(), device.facilityId, url.searchParams.get("cursor"), limit));
});
