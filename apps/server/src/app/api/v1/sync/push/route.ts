import { PushRequestSchema } from "@swen/core";
import { db } from "@/lib/db";
import { authenticateSync } from "@/lib/device-auth";
import { handle, HttpError, json, preflight, readJson } from "@/lib/http";
import { pushChanges } from "@/lib/sync";

export const OPTIONS = preflight;

export const POST = handle(async (req) => {
  const { device } = await authenticateSync(db(), req);
  const parsed = PushRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw new HttpError(400, "bad_request", { message: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  return json(await pushChanges(db(), { facilityId: device.facilityId, deviceId: device.id }, parsed.data));
});
