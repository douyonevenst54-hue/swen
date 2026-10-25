import { z } from "zod";
import { db } from "@/lib/db";
import { enrollDevice } from "@/lib/devices";
import { env } from "@/lib/env";
import { handle, HttpError, json, preflight, readJson } from "@/lib/http";

const Body = z.object({
  code: z.string().min(4).max(20),
  deviceName: z.string().min(1).max(80),
  appVersion: z.string().max(40).nullish(),
});

export const OPTIONS = preflight;

export const POST = handle(async (req) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "bad_request");
  return json(await enrollDevice(db(), env.keyEncryptionKey, parsed.data));
});
