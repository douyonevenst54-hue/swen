/**
 * Record shapes shared by the field app and the server, and the sync contract.
 *
 * Two kinds of records:
 *  - Append-only (observations, escalations, stock movements): never edited.
 *    A correction is a new record that points at the old one. Sync is
 *    idempotent by id, so there are no conflicts.
 *  - Last-write-wins (patients, items): the copy with the newest `updatedAt`
 *    wins. Device clocks are corrected with the offset the server reports.
 */
import { z } from "zod";
import { AVPU } from "./mews";

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optNum = z.number().finite().nullable().optional();

export const Role = z.enum(["nurse", "doctor", "pharmacy", "supervisor", "reception"]);
export type Role = z.infer<typeof Role>;

export const Sex = z.enum(["F", "M", "U"]);

const optText = (max: number) => z.string().max(max).nullable().optional();

export const BirthDatePrecisionSchema = z.enum(["exact", "year", "estimated"]);

export const PatientSchema = z.object({
  id: uuid,
  /** Empty when the patient is not on a ward (outpatient). */
  ward: z.string().max(60),
  bed: z.string().max(20).nullable().optional(),
  mrn: z.string().max(60).nullable().optional(),
  givenName: z.string().min(1).max(120),
  familyName: z.string().min(1).max(120),
  sex: Sex,
  /** Maiden name, married name, nickname: any other name the person is known by. */
  otherNames: optText(200),
  birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
  /** Full date when known (YYYY-MM-DD). */
  birthDate: isoDate.nullable().optional(),
  /** Whether the birth year is exact, the year only, or estimated from the age. */
  birthDatePrecision: BirthDatePrecisionSchema.nullable().optional(),
  isPregnant: z.boolean().default(false),
  phone: optText(40),
  motherName: optText(120),
  commune: optText(80),
  /** Section communale, neighbourhood, landmarks. */
  address: optText(200),
  nationalId: optText(40),
  emergencyName: optText(120),
  emergencyRelation: optText(60),
  emergencyPhone: optText(40),
  /** Patient number, assigned by the server in the facility's series (e.g. HUL-000123). */
  number: optText(30),
  notes: z.string().max(2000).nullable().optional(),
  dischargedAt: isoDateTime.nullable().optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  updatedBy: uuid,
});
export type Patient = z.infer<typeof PatientSchema>;

export const ObservationSchema = z.object({
  id: uuid,
  patientId: uuid,
  recordedAt: isoDateTime,
  recordedBy: uuid,
  rr: optNum,
  hr: optNum,
  sbp: optNum,
  dbp: optNum,
  tempC: optNum,
  spo2: optNum,
  avpu: z.enum(AVPU).nullable().optional(),
  /** Which values came from a Bluetooth device rather than typing. */
  sources: z.record(z.string(), z.enum(["manual", "ble"])).default({}),
  /** Score as computed on the device; the server recomputes and stores its own. */
  mewsTotal: z.number().int().nullable().optional(),
  mewsLevel: z.enum(["low", "medium", "high"]).nullable().optional(),
  supersedesId: uuid.nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  /** True when the nurse scanned the patient's wristband before saving. */
  patientScanned: z.boolean().default(false),
  /** Which registered instrument measured each vital sign, e.g. { spo2: <equipment id> }. */
  equipment: z.record(z.string(), uuid).default({}),
  /** The visit (e.g. triage at arrival) this reading belongs to. */
  visitId: uuid.nullable().optional(),
});
export type Observation = z.infer<typeof ObservationSchema>;

// ---- Visits ---------------------------------------------------------------------

/**
 * A visit is the spine of the record: an appointment, an outpatient
 * consultation, an emergency or an inpatient stay. It moves through the queue
 * statuses; last write wins.
 */
export const VisitKind = z.enum(["outpatient", "emergency", "inpatient"]);
export type VisitKind = z.infer<typeof VisitKind>;
export const VisitStatus = z.enum(["booked", "waiting", "triaged", "consulting", "done", "left", "cancelled"]);
export type VisitStatus = z.infer<typeof VisitStatus>;
/** Emergency triage colour (South African Triage Scale): red = immediate … green = can wait. */
export const TriageColor = z.enum(["red", "orange", "yellow", "green"]);
export type TriageColor = z.infer<typeof TriageColor>;

export const VisitSchema = z.object({
  id: uuid,
  patientId: uuid,
  kind: VisitKind,
  service: z.string().min(1).max(80),
  status: VisitStatus,
  /** Appointment date and time, for booked visits. */
  scheduledFor: isoDateTime.nullable().optional(),
  arrivedAt: isoDateTime.nullable().optional(),
  endedAt: isoDateTime.nullable().optional(),
  triageColor: TriageColor.nullable().optional(),
  chiefComplaint: optText(300),
  /** Doctor the patient is waiting for, if any. */
  assignedTo: uuid.nullable().optional(),
  note: optText(1000),
  createdAt: isoDateTime,
  createdBy: uuid,
  updatedAt: isoDateTime,
  updatedBy: uuid,
});
export type Visit = z.infer<typeof VisitSchema>;

export const EquipmentSchema = z.object({
  id: uuid,
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  kind: z.enum(["oximeter", "bp", "thermometer", "other"]),
  serial: z.string().max(120).nullable().optional(),
  lastCheckedAt: isoDateTime.nullable().optional(),
  active: z.boolean(),
  updatedAt: isoDateTime,
});
export type Equipment = z.infer<typeof EquipmentSchema>;

export const EscalationAction = z.enum([
  "informed_nurse_in_charge",
  "called_doctor",
  "doctor_reviewed",
  "increased_monitoring",
  "transferred",
  "other",
]);
export type EscalationAction = z.infer<typeof EscalationAction>;

export const EscalationSchema = z.object({
  id: uuid,
  observationId: uuid,
  patientId: uuid,
  action: EscalationAction,
  at: isoDateTime,
  by: uuid,
  note: z.string().max(1000).nullable().optional(),
});
export type Escalation = z.infer<typeof EscalationSchema>;

export const ItemSchema = z.object({
  id: uuid,
  code: z.string().min(1).max(64),
  nameHt: z.string().min(1).max(120),
  nameFr: z.string().min(1).max(120),
  unit: z.string().min(1).max(30),
  category: z.string().max(60).nullable().optional(),
  minStock: z.number().int().min(0),
  active: z.boolean().default(true),
  updatedAt: isoDateTime,
});
export type Item = z.infer<typeof ItemSchema>;

export const MovementType = z.enum([
  "receive",
  "dispense",
  "transfer_in",
  "transfer_out",
  "adjust_up",
  "adjust_down",
  "expire",
  "damage",
]);

export const StockMovementSchema = z.object({
  id: uuid,
  itemId: uuid,
  type: MovementType,
  /** Always positive; direction comes from `type`. */
  quantity: z.number().int().positive(),
  lot: z.string().max(60).nullable().optional(),
  expiryDate: isoDate.nullable().optional(),
  location: z.string().max(60).nullable().optional(),
  patientId: uuid.nullable().optional(),
  at: isoDateTime,
  by: uuid,
  note: z.string().max(500).nullable().optional(),
});
export type StockMovement = z.infer<typeof StockMovementSchema>;

export const StaffSchema = z.object({
  id: uuid,
  name: z.string(),
  role: Role,
  active: z.boolean(),
  /** When the PIN was last set. A device drops an offline key wrapped before this. */
  pinSetAt: isoDateTime,
});
export type Staff = z.infer<typeof StaffSchema>;

// ---- Sync contract ----------------------------------------------------------

export const PUSH_BATCH_LIMIT = 200;

export const PushRequestSchema = z.object({
  patients: z.array(PatientSchema).max(PUSH_BATCH_LIMIT).default([]),
  visits: z.array(VisitSchema).max(PUSH_BATCH_LIMIT).default([]),
  observations: z.array(ObservationSchema).max(PUSH_BATCH_LIMIT).default([]),
  escalations: z.array(EscalationSchema).max(PUSH_BATCH_LIMIT).default([]),
  items: z.array(ItemSchema).max(PUSH_BATCH_LIMIT).default([]),
  movements: z.array(StockMovementSchema).max(PUSH_BATCH_LIMIT).default([]),
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export interface PushResponse {
  /** Ids now safely stored on the server (including ones it already had). */
  accepted: string[];
  /**
   * Records the server would not store. `retryable` means a record it depends
   * on (e.g. the patient) has not arrived yet, so the device should try again
   * later. Non-retryable records need a person to look at them.
   */
  rejected: { id: string; reason: RejectReason; retryable: boolean }[];
  serverTime: string;
}

export type RejectReason =
  | "unknown_patient"
  | "unknown_visit"
  | "unknown_observation"
  | "unknown_item"
  | "unknown_staff"
  | "other_facility"
  | "duplicate_code"
  | "invalid";

export const RETRYABLE_REASONS: ReadonlySet<RejectReason> = new Set(["unknown_patient", "unknown_observation", "unknown_item", "unknown_visit"]);

export interface PullResponse {
  cursor: string;
  hasMore: boolean;
  serverTime: string;
  facility: { id: string; name: string; mewsConfig: unknown | null };
  staff: Staff[];
  changes: {
    patients: Patient[];
    visits: Visit[];
    observations: Observation[];
    escalations: Escalation[];
    items: Item[];
    movements: StockMovement[];
    equipment: Equipment[];
  };
}

export interface EnrollResponse {
  deviceId: string;
  deviceToken: string;
  facility: { id: string; name: string };
  staff: Staff[];
  serverTime: string;
}

export interface RosterResponse {
  staff: Staff[];
  serverTime: string;
}

export interface UnlockResponse {
  staff: Staff;
  /** Base64 raw AES-256 key that encrypts patient data on this device. */
  deviceKey: string;
  /** Bearer token for sync, sent as X-Staff-Session. */
  session: { token: string; expiresAt: string };
  serverTime: string;
}

/** Error body for every non-2xx API response. */
export interface ApiError {
  error: ApiErrorCode;
  message?: string;
  /** For "locked_out": when the staff member may try again. */
  retryAt?: string;
}

export type ApiErrorCode =
  | "bad_request"
  | "invalid_code"
  | "unauthorized"
  | "device_revoked"
  | "session_expired"
  | "wrong_pin"
  | "locked_out"
  | "staff_inactive"
  | "not_found"
  | "server_error";

export const API_PREFIX = "/api/v1";

/** Actor id recorded for changes made from the supervisor dashboard rather than a staff device. */
export const DASHBOARD_ACTOR_ID = "00000000-0000-4000-8000-000000000000";
