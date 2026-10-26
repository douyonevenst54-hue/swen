-- AlterTable
ALTER TABLE "Observation" ADD COLUMN     "equipment" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "patientScanned" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Equipment" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "serial" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Equipment_facilityId_seq_idx" ON "Equipment"("facilityId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_facilityId_code_key" ON "Equipment"("facilityId", "code");

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sync sequence stamp (hand-written, see the init migration)
CREATE TRIGGER "Equipment_seq" BEFORE INSERT OR UPDATE ON "Equipment" FOR EACH ROW EXECUTE FUNCTION "swen_stamp_seq"();
