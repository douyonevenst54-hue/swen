-- CreateEnum
CREATE TYPE "Role" AS ENUM ('nurse', 'doctor', 'pharmacy', 'supervisor');

-- CreateTable
CREATE TABLE "Facility" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Port-au-Prince',
    "mewsConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "keyCiphertext" TEXT NOT NULL,
    "appVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentCode" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "deviceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "pinHash" TEXT NOT NULL,
    "pinSetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSession" (
    "id" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "ward" TEXT NOT NULL,
    "bed" TEXT,
    "mrn" TEXT,
    "givenName" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "birthYear" INTEGER,
    "isPregnant" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "dischargedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID NOT NULL,
    "deviceId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "recordedBy" UUID NOT NULL,
    "rr" DOUBLE PRECISION,
    "hr" DOUBLE PRECISION,
    "sbp" DOUBLE PRECISION,
    "dbp" DOUBLE PRECISION,
    "tempC" DOUBLE PRECISION,
    "spo2" DOUBLE PRECISION,
    "avpu" TEXT,
    "sources" JSONB NOT NULL DEFAULT '{}',
    "deviceMewsTotal" INTEGER,
    "deviceMewsLevel" TEXT,
    "mewsTotal" INTEGER NOT NULL,
    "mewsLevel" TEXT NOT NULL,
    "mewsComplete" BOOLEAN NOT NULL,
    "supersedesId" UUID,
    "note" TEXT,
    "deviceId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Escalation" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "observationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "by" UUID NOT NULL,
    "note" TEXT,
    "deviceId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Escalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameHt" TEXT NOT NULL,
    "nameFr" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT,
    "minStock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lot" TEXT,
    "expiryDate" TEXT,
    "location" TEXT,
    "patientId" UUID,
    "at" TIMESTAMP(3) NOT NULL,
    "by" UUID NOT NULL,
    "note" TEXT,
    "deviceId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cabinet" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "tokenHash" TEXT NOT NULL,
    "doorOpen" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cabinet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CabinetEvent" (
    "id" UUID NOT NULL,
    "cabinetId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CabinetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE INDEX "Device_facilityId_idx" ON "Device"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentCode_codeHash_key" ON "EnrollmentCode"("codeHash");

-- CreateIndex
CREATE INDEX "EnrollmentCode_facilityId_idx" ON "EnrollmentCode"("facilityId");

-- CreateIndex
CREATE INDEX "Staff_facilityId_seq_idx" ON "Staff"("facilityId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSession_tokenHash_key" ON "StaffSession"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffSession_staffId_idx" ON "StaffSession"("staffId");

-- CreateIndex
CREATE INDEX "StaffSession_deviceId_idx" ON "StaffSession"("deviceId");

-- CreateIndex
CREATE INDEX "Patient_facilityId_seq_idx" ON "Patient"("facilityId", "seq");

-- CreateIndex
CREATE INDEX "Patient_facilityId_ward_idx" ON "Patient"("facilityId", "ward");

-- CreateIndex
CREATE INDEX "Observation_facilityId_seq_idx" ON "Observation"("facilityId", "seq");

-- CreateIndex
CREATE INDEX "Observation_patientId_recordedAt_idx" ON "Observation"("patientId", "recordedAt");

-- CreateIndex
CREATE INDEX "Escalation_facilityId_seq_idx" ON "Escalation"("facilityId", "seq");

-- CreateIndex
CREATE INDEX "Escalation_observationId_idx" ON "Escalation"("observationId");

-- CreateIndex
CREATE INDEX "Item_facilityId_seq_idx" ON "Item"("facilityId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Item_facilityId_code_key" ON "Item"("facilityId", "code");

-- CreateIndex
CREATE INDEX "StockMovement_facilityId_seq_idx" ON "StockMovement"("facilityId", "seq");

-- CreateIndex
CREATE INDEX "StockMovement_itemId_idx" ON "StockMovement"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Cabinet_tokenHash_key" ON "Cabinet"("tokenHash");

-- CreateIndex
CREATE INDEX "Cabinet_facilityId_idx" ON "Cabinet"("facilityId");

-- CreateIndex
CREATE INDEX "CabinetEvent_cabinetId_at_idx" ON "CabinetEvent"("cabinetId", "at");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentCode" ADD CONSTRAINT "EnrollmentCode_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cabinet" ADD CONSTRAINT "Cabinet_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CabinetEvent" ADD CONSTRAINT "CabinetEvent_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Sync sequence (hand-written; Prisma does not manage triggers).
-- Every insert or update on a synced table takes the next value of one shared
-- sequence. Devices pull rows with seq greater than their cursor.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE "swen_sync_seq" AS BIGINT START 1;

CREATE FUNCTION "swen_stamp_seq"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."seq" := nextval('"swen_sync_seq"');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Staff_seq" BEFORE INSERT OR UPDATE ON "Staff" FOR EACH ROW EXECUTE FUNCTION "swen_stamp_seq"();
CREATE TRIGGER "Patient_seq" BEFORE INSERT OR UPDATE ON "Patient" FOR EACH ROW EXECUTE FUNCTION "swen_stamp_seq"();
CREATE TRIGGER "Observation_seq" BEFORE INSERT OR UPDATE ON "Observation" FOR EACH ROW EXECUTE FUNCTION "swen_stamp_seq"();
CREATE TRIGGER "Escalation_seq" BEFORE INSERT OR UPDATE ON "Escalation" FOR EACH ROW EXECUTE FUNCTION "swen_stamp_seq"();
CREATE TRIGGER "Item_seq" BEFORE INSERT OR UPDATE ON "Item" FOR EACH ROW EXECUTE FUNCTION "swen_stamp_seq"();
CREATE TRIGGER "StockMovement_seq" BEFORE INSERT OR UPDATE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION "swen_stamp_seq"();
