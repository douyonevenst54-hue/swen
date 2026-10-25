import type { RosterResponse } from "@swen/core";
import { db } from "@/lib/db";
import { authenticateDevice } from "@/lib/device-auth";
import { handle, json, preflight } from "@/lib/http";
import { listStaff } from "@/lib/sync";

export const OPTIONS = preflight;

/** Staff names and roles for the unlock screen. Needs only the device token. */
export const GET = handle(async (req) => {
  const device = await authenticateDevice(db(), req);
  const staff = await listStaff(db(), device.facilityId);
  return json<RosterResponse>({ staff, serverTime: new Date().toISOString() });
});
