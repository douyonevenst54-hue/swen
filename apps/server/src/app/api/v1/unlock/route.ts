import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateDevice } from "@/lib/device-auth";
import { unlockStaff } from "@/lib/devices";
import { env } from "@/lib/env";
import { handle, HttpError, json, preflight, readJson } from "@/lib/http";

const Body = z.object({ staffId: z.string().uuid(), pin: z.string().min(1).max(12) });

export const OPTIONS = preflight;

export const POST = handle(async (req) => {
  const device = await authenticateDevice(db(), req);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "bad_request");
  return json(await unlockStaff(db(), env.keyEncryptionKey, device, parsed.data, env.staffSessionDays));
});
