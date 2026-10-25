import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

export type Db = InstanceType<typeof PrismaClient>;

const globalForPrisma = globalThis as unknown as { swenPrisma?: Db };

export function createPrisma(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 5 }) });
}

/** One client per server process (and per hot-reload in development). */
export function db(): Db {
  if (!globalForPrisma.swenPrisma) globalForPrisma.swenPrisma = createPrisma(env.databaseUrl);
  return globalForPrisma.swenPrisma;
}
