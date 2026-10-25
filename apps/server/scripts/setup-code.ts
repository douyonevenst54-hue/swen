/**
 * Print a new device setup code from the command line (same as the dashboard button).
 *   npm run setup-code --workspace @swen/server            # first facility
 *   npm run setup-code --workspace @swen/server -- "Lopital Sen Mak"
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createSetupCode } from "../src/lib/devices";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  const name = process.argv[2];
  const facility = name ? await db.facility.findFirst({ where: { name } }) : await db.facility.findFirst({ orderBy: { createdAt: "asc" } });
  if (!facility) throw new Error(name ? `No facility named "${name}"` : "No facility yet. Run db:seed or create one in the dashboard.");
  const { code, expiresAt } = await createSetupCode(db as never, facility.id);
  console.log(code);
  console.error(`${facility.name} — expires ${expiresAt.toISOString()}`);
}

main().finally(() => db.$disconnect());
