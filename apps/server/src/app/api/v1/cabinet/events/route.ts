import { CabinetEventsSchema, recordCabinetEvents } from "@/lib/cabinets";
import { db } from "@/lib/db";
import { bearer, handle, HttpError, json, readJson } from "@/lib/http";

/** Called by the ESP32 door sensor in each supply cabinet. */
export const POST = handle(async (req) => {
  const parsed = CabinetEventsSchema.safeParse(await readJson(req, 50_000));
  if (!parsed.success) throw new HttpError(400, "bad_request");
  const result = await recordCabinetEvents(db(), bearer(req), parsed.data);
  return json({ ...result, serverTime: new Date().toISOString() });
});
