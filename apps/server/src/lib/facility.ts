import "server-only";
import { cookies } from "next/headers";
import { db } from "./db";
import { listFacilities } from "./queries";

export const FACILITY_COOKIE = "swen_facility";

/** The facility the dashboard is looking at (cookie), defaulting to the first one. */
export async function currentFacility() {
  const facilities = await listFacilities(db());
  const wanted = (await cookies()).get(FACILITY_COOKIE)?.value;
  const facility = facilities.find((f) => f.id === wanted) ?? facilities[0] ?? null;
  return { facility, facilities };
}
