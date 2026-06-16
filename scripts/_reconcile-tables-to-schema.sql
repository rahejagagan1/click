-- Reconcile DB shape to schema.prisma for 4 tables that were
-- restored on 2026-06-12 with column shapes that didn't match the
-- Prisma models. All 4 are empty (verified pre-drop) so it's safe.
--
-- Affected:
--   • EmployeeBonus       — amount NUMERIC→Decimal(12,2), effectiveDate TIMESTAMP→DATE
--   • AdhocLineItem       — amount NUMERIC→Decimal(12,2), createdAt TIMESTAMP→Timestamptz(6)
--   • CandidateStage      — replace candidateId nullable+jobApplicationId+createdAt
--                           with schema shape (movedById, notes, movedAt)
--   • OptionList          — second index (listKey,value) covering composite lookup

DROP TABLE IF EXISTS "EmployeeBonus"  CASCADE;
DROP TABLE IF EXISTS "AdhocLineItem"  CASCADE;
DROP TABLE IF EXISTS "CandidateStage" CASCADE;
DROP TABLE IF EXISTS "OptionList"     CASCADE;

-- ── EmployeeBonus — matches model EmployeeBonus in schema.prisma ──
CREATE TABLE "EmployeeBonus" (
  "id"             SERIAL          PRIMARY KEY,
  "userId"         INTEGER         NOT NULL,
  "amount"         DECIMAL(12, 2)  NOT NULL,
  "reason"         TEXT,
  "effectiveDate"  DATE            NOT NULL,
  "bonusType"      TEXT,
  "paymentStatus"  TEXT            NOT NULL DEFAULT 'due_future',
  "attachmentName" TEXT,
  "attachmentMime" TEXT,
  "attachmentBlob" BYTEA,
  "createdAt"      TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  "createdBy"      INTEGER,
  CONSTRAINT "EmployeeBonus_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "EmployeeBonus_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL
);

-- ── AdhocLineItem — matches model AdhocLineItem in schema.prisma ──
CREATE TABLE "AdhocLineItem" (
  "id"        SERIAL          PRIMARY KEY,
  "userId"    INTEGER         NOT NULL,
  "month"     INTEGER         NOT NULL,
  "year"      INTEGER         NOT NULL,
  "kind"      TEXT            NOT NULL,
  "type"      TEXT,
  "amount"    DECIMAL(12, 2)  NOT NULL,
  "comment"   TEXT,
  "createdAt" TIMESTAMPTZ(6)  NOT NULL DEFAULT NOW(),
  "createdBy" INTEGER,
  CONSTRAINT "AdhocLineItem_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "AdhocLineItem_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX "AdhocLineItem_month_year_kind_idx" ON "AdhocLineItem"("month","year","kind");
CREATE INDEX "AdhocLineItem_userId_idx"          ON "AdhocLineItem"("userId");

-- ── CandidateStage — matches model CandidateStage in schema.prisma ──
-- candidateId points at the legacy Candidate table (which doesn't exist
-- in this DB) — FK to Candidate intentionally omitted.
CREATE TABLE "CandidateStage" (
  "id"          SERIAL       PRIMARY KEY,
  "candidateId" INTEGER      NOT NULL,
  "stageId"     INTEGER      NOT NULL,
  "movedById"   INTEGER      NOT NULL,
  "notes"       TEXT,
  "movedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "CandidateStage_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "HiringStage"("id") ON DELETE RESTRICT,
  CONSTRAINT "CandidateStage_movedById_fkey"
    FOREIGN KEY ("movedById") REFERENCES "User"("id") ON DELETE RESTRICT
);
CREATE INDEX "CandidateStage_candidateId_idx" ON "CandidateStage"("candidateId");

-- ── OptionList — matches model OptionList in schema.prisma ──
CREATE TABLE "OptionList" (
  "id"        SERIAL       PRIMARY KEY,
  "listKey"   TEXT         NOT NULL,
  "value"     TEXT         NOT NULL,
  "createdBy" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "OptionList_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "OptionList_listKey_value_key" ON "OptionList"("listKey","value");
CREATE        INDEX "OptionList_listKey_value_idx" ON "OptionList"("listKey","value");
