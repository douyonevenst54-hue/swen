import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { Db } from "../src/lib/db";
import { hashPin } from "../src/lib/crypto";

/**
 * Integration tests run against a real Postgres with the migrations applied.
 * Set TEST_DATABASE_URL to enable them; they are skipped otherwise.
 */
export const TEST_DB_URL = process.env.TEST_DATABASE_URL;

export function testDb(): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB_URL! }) }) as Db;
}

export const KEK = randomBytes(32);

export async function makeFacility(db: Db, name = `Test ${randomUUID().slice(0, 8)}`) {
  const facility = await db.facility.create({ data: { name } });
  const nurse = await db.staff.create({ data: { facilityId: facility.id, name: "Nurse A", role: "nurse", pinHash: await hashPin("123456") } });
  const doctor = await db.staff.create({ data: { facilityId: facility.id, name: "Doctor B", role: "doctor", pinHash: await hashPin("987654") } });
  return { facility, nurse, doctor };
}

export const now = () => new Date().toISOString();

export function patient(updatedBy: string, overrides: Record<string, unknown> = {}) {
  const t = now();
  return {
    id: randomUUID(),
    ward: "Sal A",
    bed: "3",
    mrn: null,
    givenName: "Marie",
    familyName: "Jean",
    sex: "F" as const,
    birthYear: 1980,
    isPregnant: false,
    notes: null,
    dischargedAt: null,
    createdAt: t,
    updatedAt: t,
    updatedBy,
    ...overrides,
  };
}

export function observation(patientId: string, recordedBy: string, overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    patientId,
    recordedAt: now(),
    recordedBy,
    rr: 16,
    hr: 80,
    sbp: 120,
    dbp: 80,
    tempC: 37,
    spo2: 98,
    avpu: "A" as const,
    sources: {},
    mewsTotal: 1,
    mewsLevel: "low" as const,
    supersedesId: null,
    note: null,
    ...overrides,
  };
}

export const emptyPush = () => ({ patients: [], observations: [], escalations: [], items: [], movements: [] });
