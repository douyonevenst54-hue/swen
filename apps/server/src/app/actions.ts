"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DASHBOARD_ACTOR_ID, DEFAULT_MEWS_CONFIG, isLocale, MovementType, Role, validateMewsConfig } from "@swen/core";
import { ADMIN_COOKIE, ADMIN_SESSION_HOURS, makeAdminCookieValue, requireAdmin } from "@/lib/admin";
import { createCabinet } from "@/lib/cabinets";
import { hashPin, isValidPin, safeEqual } from "@/lib/crypto";
import { db } from "@/lib/db";
import { createSetupCode, revokeDevice } from "@/lib/devices";
import { env } from "@/lib/env";
import { FACILITY_COOKIE, currentFacility } from "@/lib/facility";
import { getI18n, LANG_COOKIE } from "@/lib/locale";
import { withFacilityLock } from "@/lib/sync";

export type FormState = { ok: boolean; message?: string; secret?: string; at?: number } | null;

const ok = (message?: string, secret?: string): FormState => ({ ok: true, message, secret, at: Date.now() });
const fail = (message: string): FormState => ({ ok: false, message, at: Date.now() });

const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

// ---- Session & preferences ----------------------------------------------------

const loginAttempts = new Map<string, { n: number; until: number }>();

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getI18n();
  // Basic brute-force brake (per server instance).
  const key = "admin";
  const state = loginAttempts.get(key);
  if (state && state.until > Date.now()) return fail(t("unlock.lockedOut", { minutes: Math.ceil((state.until - Date.now()) / 60_000) }));

  const password = String(form.get("password") ?? "");
  if (!password || !safeEqual(password, env.adminPassword)) {
    const n = (state?.n ?? 0) + 1;
    loginAttempts.set(key, { n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    return fail(t("dash.wrongPassword"));
  }
  loginAttempts.delete(key);
  (await cookies()).set(ADMIN_COOKIE, makeAdminCookieValue(), { ...cookieOpts, maxAge: ADMIN_SESSION_HOURS * 3600 });
  redirect("/");
}

export async function logout(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
  redirect("/login");
}

export async function setLanguage(form: FormData): Promise<void> {
  const locale = form.get("locale");
  if (isLocale(locale)) (await cookies()).set(LANG_COOKIE, locale, { ...cookieOpts, httpOnly: false, maxAge: 365 * 86400 });
  revalidatePath("/", "layout");
}

export async function setFacility(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get("facilityId") ?? "");
  (await cookies()).set(FACILITY_COOKIE, id, { ...cookieOpts, maxAge: 365 * 86400 });
  revalidatePath("/", "layout");
}

async function facilityOrThrow() {
  await requireAdmin();
  const { facility } = await currentFacility();
  if (!facility) throw new Error("No facility");
  return facility;
}

// ---- Facilities & staff -------------------------------------------------------

export async function createFacility(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const { t } = await getI18n();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return fail(t("dash.invalid", { problems: t("dash.name") }));
  const f = await db().facility.create({ data: { name } });
  (await cookies()).set(FACILITY_COOKIE, f.id, { ...cookieOpts, maxAge: 365 * 86400 });
  revalidatePath("/", "layout");
  return ok(t("dash.saved"));
}

const StaffForm = z.object({ name: z.string().trim().min(1).max(80), role: Role, pin: z.string() });

export async function createStaff(_: FormState, form: FormData): Promise<FormState> {
  const facility = await facilityOrThrow();
  const { t } = await getI18n();
  const parsed = StaffForm.safeParse(Object.fromEntries(form));
  if (!parsed.success || !isValidPin(parsed.data.pin)) return fail(t("dash.invalid", { problems: t("dash.pinHelp") }));
  const pinHash = await hashPin(parsed.data.pin);
  await withFacilityLock(db(), facility.id, (tx) =>
    tx.staff.create({ data: { facilityId: facility.id, name: parsed.data.name, role: parsed.data.role, pinHash } }),
  );
  revalidatePath("/admin");
  return ok(t("dash.saved"));
}

export async function resetStaffPin(_: FormState, form: FormData): Promise<FormState> {
  const facility = await facilityOrThrow();
  const { t } = await getI18n();
  const staffId = String(form.get("staffId") ?? "");
  const pin = String(form.get("pin") ?? "");
  if (!isValidPin(pin)) return fail(t("dash.invalid", { problems: t("dash.pinHelp") }));
  const pinHash = await hashPin(pin);
  await withFacilityLock(db(), facility.id, async (tx) => {
    await tx.staff.update({ where: { id: staffId, facilityId: facility.id }, data: { pinHash, pinSetAt: new Date(), failedAttempts: 0, lockedUntil: null } });
    // A new PIN ends existing sessions; devices will ask the person to unlock again.
    await tx.staffSession.deleteMany({ where: { staffId } });
  });
  revalidatePath("/admin");
  return ok(t("dash.saved"));
}

export async function toggleStaff(form: FormData): Promise<void> {
  const facility = await facilityOrThrow();
  const staffId = String(form.get("staffId") ?? "");
  await withFacilityLock(db(), facility.id, async (tx) => {
    const s = await tx.staff.findFirstOrThrow({ where: { id: staffId, facilityId: facility.id }, select: { active: true } });
    await tx.staff.update({ where: { id: staffId }, data: { active: !s.active } });
    if (s.active) await tx.staffSession.deleteMany({ where: { staffId } });
  });
  revalidatePath("/admin");
}

// ---- Devices & cabinets -------------------------------------------------------

export async function newSetupCode(_: FormState): Promise<FormState> {
  const facility = await facilityOrThrow();
  const { t, fmtDateTime } = await getI18n();
  const { code, expiresAt } = await createSetupCode(db(), facility.id);
  revalidatePath("/admin");
  return ok(t("dash.expires", { time: fmtDateTime(expiresAt) }), code);
}

export async function revokeDeviceAction(form: FormData): Promise<void> {
  const facility = await facilityOrThrow();
  const deviceId = String(form.get("deviceId") ?? "");
  const device = await db().device.findFirst({ where: { id: deviceId, facilityId: facility.id }, select: { id: true } });
  if (device) await revokeDevice(db(), device.id);
  revalidatePath("/admin");
}

export async function createCabinetAction(_: FormState, form: FormData): Promise<FormState> {
  const facility = await facilityOrThrow();
  const { t } = await getI18n();
  const name = String(form.get("name") ?? "").trim();
  const location = String(form.get("location") ?? "").trim() || null;
  if (!name) return fail(t("dash.invalid", { problems: t("dash.name") }));
  const { token } = await createCabinet(db(), facility.id, name, location);
  revalidatePath("/admin");
  return ok(t("dash.cabinetToken"), token);
}

// ---- Inventory ------------------------------------------------------------------

const ItemForm = z.object({
  code: z.string().trim().min(1).max(64),
  nameHt: z.string().trim().min(1).max(120),
  nameFr: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(30),
  category: z.string().trim().max(60).optional(),
  minStock: z.coerce.number().int().min(0).max(1_000_000),
});

export async function createItem(_: FormState, form: FormData): Promise<FormState> {
  const facility = await facilityOrThrow();
  const { t } = await getI18n();
  const parsed = ItemForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(t("dash.invalid", { problems: parsed.error.issues.map((i) => i.path.join(".")).join(", ") }));
  const exists = await db().item.findFirst({ where: { facilityId: facility.id, code: parsed.data.code }, select: { id: true } });
  if (exists) return fail(t("dash.invalid", { problems: `${t("dash.code")} ${parsed.data.code}` }));
  await withFacilityLock(db(), facility.id, (tx) =>
    tx.item.create({
      data: { id: randomUUID(), facilityId: facility.id, ...parsed.data, category: parsed.data.category || null, updatedAt: new Date() },
    }),
  );
  revalidatePath("/inventory");
  return ok(t("dash.saved"));
}

export async function updateItemMin(form: FormData): Promise<void> {
  const facility = await facilityOrThrow();
  const itemId = String(form.get("itemId") ?? "");
  const minStock = Math.max(0, Math.floor(Number(form.get("minStock") ?? 0)));
  await withFacilityLock(db(), facility.id, (tx) => tx.item.update({ where: { id: itemId, facilityId: facility.id }, data: { minStock, updatedAt: new Date() } }));
  revalidatePath("/inventory");
}

export async function toggleItem(form: FormData): Promise<void> {
  const facility = await facilityOrThrow();
  const itemId = String(form.get("itemId") ?? "");
  await withFacilityLock(db(), facility.id, async (tx) => {
    const it = await tx.item.findFirstOrThrow({ where: { id: itemId, facilityId: facility.id }, select: { active: true } });
    await tx.item.update({ where: { id: itemId }, data: { active: !it.active, updatedAt: new Date() } });
  });
  revalidatePath("/inventory");
}

const MovementForm = z.object({
  itemId: z.string().uuid(),
  type: MovementType,
  quantity: z.coerce.number().int().positive().max(1_000_000),
  lot: z.string().trim().max(60).optional(),
  expiryDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function recordMovement(_: FormState, form: FormData): Promise<FormState> {
  const facility = await facilityOrThrow();
  const { t } = await getI18n();
  const parsed = MovementForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(t("dash.invalid", { problems: parsed.error.issues.map((i) => i.path.join(".")).join(", ") }));
  const item = await db().item.findFirst({ where: { id: parsed.data.itemId, facilityId: facility.id }, select: { id: true } });
  if (!item) return fail(t("inventory.notFound", { code: parsed.data.itemId }));
  await withFacilityLock(db(), facility.id, (tx) =>
    tx.stockMovement.create({
      data: {
        id: randomUUID(),
        facilityId: facility.id,
        itemId: item.id,
        type: parsed.data.type,
        quantity: parsed.data.quantity,
        lot: parsed.data.lot || null,
        expiryDate: parsed.data.expiryDate || null,
        note: parsed.data.note || null,
        at: new Date(),
        by: DASHBOARD_ACTOR_ID,
      },
    }),
  );
  revalidatePath("/inventory");
  return ok(t("inventory.saved"));
}

// ---- MEWS rules -------------------------------------------------------------------

export async function saveMewsConfig(_: FormState, form: FormData): Promise<FormState> {
  const facility = await facilityOrThrow();
  const { t } = await getI18n();
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(form.get("config") ?? ""));
  } catch {
    return fail(t("dash.invalid", { problems: "JSON" }));
  }
  const problems = validateMewsConfig(parsed);
  if (problems.length) return fail(t("dash.invalid", { problems: problems.join("; ") }));
  await db().facility.update({ where: { id: facility.id }, data: { mewsConfig: parsed as object } });
  revalidatePath("/", "layout");
  return ok(t("dash.mewsSaved"));
}

export async function resetMewsConfig(_: FormState): Promise<FormState> {
  const facility = await facilityOrThrow();
  const { t } = await getI18n();
  await db().facility.update({ where: { id: facility.id }, data: { mewsConfig: DEFAULT_MEWS_CONFIG } });
  revalidatePath("/", "layout");
  return ok(t("dash.mewsSaved"));
}

// ---- Measuring equipment (traceability) ------------------------------------------

const EquipmentForm = z.object({
  code: z.string().trim().max(64).optional(),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["oximeter", "bp", "thermometer", "other"]),
  serial: z.string().trim().max(120).optional(),
});

export async function createEquipment(_: FormState, form: FormData): Promise<FormState> {
  const facility = await facilityOrThrow();
  const { t } = await getI18n();
  const parsed = EquipmentForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(t("dash.invalid", { problems: parsed.error.issues.map((i) => i.path.join(".")).join(", ") }));
  const prefix = { oximeter: "OXI", bp: "TA", thermometer: "TEMP", other: "EQ" }[parsed.data.kind];
  // Asset tag: given, or the next free number for this kind (OXI-001, OXI-002…).
  let code = parsed.data.code?.toUpperCase();
  if (!code) {
    const count = await db().equipment.count({ where: { facilityId: facility.id, kind: parsed.data.kind } });
    code = `${prefix}-${String(count + 1).padStart(3, "0")}`;
  }
  const clash = await db().equipment.findFirst({ where: { facilityId: facility.id, code }, select: { id: true } });
  if (clash) return fail(t("dash.invalid", { problems: `${t("dash.code")} ${code}` }));
  await withFacilityLock(db(), facility.id, (tx) =>
    tx.equipment.create({
      data: { id: randomUUID(), facilityId: facility.id, code, name: parsed.data.name, kind: parsed.data.kind, serial: parsed.data.serial || null, updatedAt: new Date() },
    }),
  );
  revalidatePath("/admin");
  return ok(`${t("dash.saved")} ${code}`);
}

export async function markEquipmentChecked(form: FormData): Promise<void> {
  const facility = await facilityOrThrow();
  const id = String(form.get("equipmentId") ?? "");
  const now = new Date();
  await withFacilityLock(db(), facility.id, (tx) => tx.equipment.update({ where: { id, facilityId: facility.id }, data: { lastCheckedAt: now, updatedAt: now } }));
  revalidatePath("/admin");
}

export async function toggleEquipment(form: FormData): Promise<void> {
  const facility = await facilityOrThrow();
  const id = String(form.get("equipmentId") ?? "");
  await withFacilityLock(db(), facility.id, async (tx) => {
    const e = await tx.equipment.findFirstOrThrow({ where: { id, facilityId: facility.id }, select: { active: true } });
    await tx.equipment.update({ where: { id }, data: { active: !e.active, updatedAt: new Date() } });
  });
  revalidatePath("/admin");
}
