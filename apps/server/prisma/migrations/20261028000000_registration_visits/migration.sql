-- Registration and visits: full patient identity, patient numbers, the visit queue.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'reception';

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN "patientPrefix" TEXT,
ADD COLUMN "patientCounter" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN "otherNames" TEXT,
ADD COLUMN "birthDate" TEXT,
ADD COLUMN "birthDatePrecision" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "motherName" TEXT,
ADD COLUMN "commune" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "nationalId" TEXT,
ADD COLUMN "emergencyName" TEXT,
ADD COLUMN "emergencyRelation" TEXT,
ADD COLUMN "emergencyPhone" TEXT,
ADD COLUMN "number" TEXT;

-- AlterTable
ALTER TABLE "Observation" ADD COLUMN "visitId" UUID;

-- CreateTable
CREATE TABLE "Visit" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "triageColor" TEXT,
    "chiefComplaint" TEXT,
    "assignedTo" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID NOT NULL,
    "deviceId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visit_facilityId_seq_idx" ON "Visit"("facilityId", "seq");
CREATE INDEX "Visit_facilityId_arrivedAt_idx" ON "Visit"("facilityId", "arrivedAt");
CREATE INDEX "Visit_patientId_idx" ON "Visit"("patientId");
CREATE UNIQUE INDEX "Patient_facilityId_number_key" ON "Patient"("facilityId", "number");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sync sequence stamp (hand-written, see the init migration)
CREATE TRIGGER "Visit_seq" BEFORE INSERT OR UPDATE ON "Visit" FOR EACH ROW EXECUTE FUNCTION "swen_stamp_seq"();
