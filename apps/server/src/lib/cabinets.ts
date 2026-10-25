/** Smart supply cabinet: door sensor events from the ESP32 firmware. */
import { z } from "zod";
import type { Db } from "./db";
import { hashToken, newToken } from "./crypto";
import { HttpError } from "./http";

export const CabinetEventsSchema = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(["door_open", "door_close", "heartbeat"]),
        /** How long ago the event happened, for events buffered while Wi-Fi was down. */
        agoMs: z.number().int().min(0).max(7 * 86_400_000).default(0),
      }),
    )
    .min(1)
    .max(100),
});
export type CabinetEventsInput = z.infer<typeof CabinetEventsSchema>;

/** Minutes after which an open door is shown as "left open". */
export const LEFT_OPEN_MINUTES = 5;

export async function createCabinet(db: Db, facilityId: string, name: string, location: string | null): Promise<{ id: string; token: string }> {
  const token = newToken();
  const cabinet = await db.cabinet.create({ data: { facilityId, name, location, tokenHash: hashToken(token) }, select: { id: true } });
  return { id: cabinet.id, token };
}

export async function recordCabinetEvents(db: Db, token: string | null, input: CabinetEventsInput, now = new Date()): Promise<{ stored: number; doorOpen: boolean }> {
  if (!token) throw new HttpError(401, "unauthorized");
  const cabinet = await db.cabinet.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, doorOpen: true } });
  if (!cabinet) throw new HttpError(401, "unauthorized");

  const events = input.events
    .map((e) => ({ type: e.type, at: new Date(now.getTime() - e.agoMs) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const doorEvents = events.filter((e) => e.type !== "heartbeat");
  const last = doorEvents[doorEvents.length - 1];
  const doorOpen = last ? last.type === "door_open" : cabinet.doorOpen;

  await db.$transaction([
    ...(doorEvents.length ? [db.cabinetEvent.createMany({ data: doorEvents.map((e) => ({ cabinetId: cabinet.id, type: e.type, at: e.at })) })] : []),
    db.cabinet.update({ where: { id: cabinet.id }, data: { doorOpen, lastSeenAt: now } }),
  ]);
  return { stored: doorEvents.length, doorOpen };
}
