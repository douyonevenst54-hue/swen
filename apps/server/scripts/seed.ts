/**
 * Demo data: one facility, three staff members, a starter supply catalog and a
 * device setup code. Run with `npm run db:seed` after `prisma migrate dev`.
 *
 *   SEED_FACILITY_NAME="Lopital Sen Mak" npm run db:seed
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { DASHBOARD_ACTOR_ID } from "@swen/core";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPin } from "../src/lib/crypto";
import { createSetupCode } from "../src/lib/devices";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const STAFF = [
  { name: "Enfimyè Demo", role: "nurse" as const, pin: "111111" },
  { name: "Doktè Demo", role: "doctor" as const, pin: "222222" },
  { name: "Famasi Demo", role: "pharmacy" as const, pin: "333333" },
];

// Code, Kreyòl, French, unit, category, minimum
const ITEMS: [string, string, string, string, string, number][] = [
  ["GLOVE-M", "Gan egzamen (M)", "Gants d'examen (M)", "bwat 100", "Pwoteksyon", 5],
  ["GLOVE-L", "Gan egzamen (L)", "Gants d'examen (L)", "bwat 100", "Pwoteksyon", 5],
  ["MASK-SURG", "Mas chirijikal", "Masque chirurgical", "bwat 50", "Pwoteksyon", 4],
  ["PARA-500", "Parasetamòl 500 mg", "Paracétamol 500 mg", "konprime", "Medikaman", 500],
  ["AMOX-500", "Amoksisilin 500 mg", "Amoxicilline 500 mg", "kapsil", "Medikaman", 300],
  ["ORS", "Sewòm oral (SRO)", "Sels de réhydratation orale", "sache", "Medikaman", 100],
  ["RL-1L", "Ringer laktat 1 L", "Ringer lactate 1 L", "sache", "Pèfizyon", 40],
  ["NS-1L", "Sewòm fizyolojik 0.9% 1 L", "Sérum physiologique 0,9 % 1 L", "sache", "Pèfizyon", 40],
  ["IV-CATH-20", "Katetè IV 20G", "Cathéter IV 20G", "inite", "Pèfizyon", 50],
  ["SYR-5ML", "Sereng 5 ml", "Seringue 5 ml", "inite", "Enjeksyon", 100],
  ["GAUZE", "Konprès steril", "Compresses stériles", "pake", "Pansman", 30],
  ["O2-CANNULA", "Kanil nazal oksijèn", "Lunettes à oxygène", "inite", "Oksijèn", 20],
];

async function main() {
  const name = process.env.SEED_FACILITY_NAME ?? "Lopital Demo";
  let facility = await db.facility.findFirst({ where: { name } });
  if (!facility) facility = await db.facility.create({ data: { name } });
  console.log(`Facility: ${facility.name} (${facility.id})`);

  for (const s of STAFF) {
    const exists = await db.staff.findFirst({ where: { facilityId: facility.id, name: s.name } });
    if (!exists) await db.staff.create({ data: { facilityId: facility.id, name: s.name, role: s.role, pinHash: await hashPin(s.pin) } });
    console.log(`Staff: ${s.name} — PIN ${s.pin}`);
  }

  const today = new Date();
  const inMonths = (m: number) => new Date(today.getFullYear(), today.getMonth() + m, 28).toISOString().slice(0, 10);
  for (const [code, nameHt, nameFr, unit, category, minStock] of ITEMS) {
    const exists = await db.item.findFirst({ where: { facilityId: facility.id, code } });
    if (exists) continue;
    const item = await db.item.create({ data: { id: randomUUID(), facilityId: facility.id, code, nameHt, nameFr, unit, category, minStock, updatedAt: new Date() } });
    await db.stockMovement.create({
      data: {
        id: randomUUID(), facilityId: facility.id, itemId: item.id, type: "receive", quantity: minStock * 3,
        lot: `L${today.getFullYear()}-01`, expiryDate: inMonths(18), at: new Date(), by: DASHBOARD_ACTOR_ID, note: "seed",
      },
    });
  }
  console.log(`Items: ${ITEMS.length}`);

  const { code, expiresAt } = await createSetupCode(db as never, facility.id);
  console.log(`\nDevice setup code: ${code}  (expires ${expiresAt.toISOString()})`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
