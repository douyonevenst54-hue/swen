/**
 * Local database (IndexedDB via Dexie). Every record a nurse creates is saved
 * here first; sync sends it to the server later.
 *
 * `dirty`: 0 = synced, 1 = waiting to be sent, 2 = rejected by the server
 * (needs a person to look at it; see Settings).
 */
import Dexie, { type EntityTable } from "dexie";
import type { Escalation, Item, Observation, Patient, StockMovement } from "@swen/core";

export type Dirty = 0 | 1 | 2;

export interface Sealed {
  iv: string; // base64
  ct: string; // base64
}

/** Patient identity fields are encrypted at rest; only routing fields stay readable. */
export type PatientPrivate = Pick<Patient, "givenName" | "familyName" | "mrn" | "notes" | "sex" | "birthYear" | "isPregnant">;

export interface PatientRow {
  id: string;
  ward: string;
  bed: string | null;
  dischargedAt: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  enc: Sealed;
  dirty: Dirty;
}

export type ObservationRow = Observation & { dirty: Dirty };
export type EscalationRow = Escalation & { dirty: Dirty };
export type ItemRow = Item & { dirty: Dirty };
export type MovementRow = StockMovement & { dirty: Dirty };

export interface RejectedRow {
  id: string;
  table: "patients" | "observations" | "escalations" | "items" | "movements";
  reason: string;
  at: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export class SwenDb extends Dexie {
  meta!: EntityTable<MetaRow, "key">;
  patients!: EntityTable<PatientRow, "id">;
  observations!: EntityTable<ObservationRow, "id">;
  escalations!: EntityTable<EscalationRow, "id">;
  items!: EntityTable<ItemRow, "id">;
  movements!: EntityTable<MovementRow, "id">;
  rejected!: EntityTable<RejectedRow, "id">;

  constructor(name = "swen") {
    super(name);
    this.version(1).stores({
      meta: "key",
      patients: "id, ward, dirty, updatedAt",
      observations: "id, patientId, recordedAt, dirty, [patientId+recordedAt]",
      escalations: "id, observationId, patientId, dirty",
      items: "id, &code, dirty",
      movements: "id, itemId, at, dirty",
      rejected: "id, table",
    });
  }
}

let instance: SwenDb | null = null;
export function localDb(): SwenDb {
  if (!instance) instance = new SwenDb();
  return instance;
}

/** For tests: use a separate database. */
export function setLocalDb(db: SwenDb): void {
  instance = db;
}

// ---- Typed key-value settings ------------------------------------------------

export interface DeviceRegistration {
  serverUrl: string;
  deviceId: string;
  deviceToken: string;
  deviceName: string;
  facility: { id: string; name: string };
  enrolledAt: string;
}

export interface WrappedKey {
  salt: string;
  iv: string;
  ct: string;
  iterations: number;
  /** When this was created (last successful online unlock). */
  wrappedAt?: string;
}

export interface LocalLockout {
  failures: number;
  lockedUntil: number | null;
}

export interface MetaTypes {
  device: DeviceRegistration;
  roster: import("@swen/core").Staff[];
  pullCursor: string;
  clockOffsetMs: number;
  lastSyncAt: string;
  mewsConfig: unknown;
  locale: import("@swen/core").Locale;
  /** Per staff id: the device data key, wrapped with a key derived from their PIN. */
  wrappedKeys: Record<string, WrappedKey>;
  /** Per staff id: the sync session token, encrypted with the device data key. */
  sessions: Record<string, { sealed: Sealed; expiresAt: string }>;
  lockouts: Record<string, LocalLockout>;
  revoked: boolean;
}

export async function getMeta<K extends keyof MetaTypes>(key: K, db: SwenDb = localDb()): Promise<MetaTypes[K] | undefined> {
  return (await db.meta.get(key))?.value as MetaTypes[K] | undefined;
}

export async function setMeta<K extends keyof MetaTypes>(key: K, value: MetaTypes[K], db: SwenDb = localDb()): Promise<void> {
  await db.meta.put({ key, value });
}
