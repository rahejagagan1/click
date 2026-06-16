-- Restore 9 tables silently dropped by prisma db push --accept-data-loss
-- on 2026-06-12. Idempotent — all CREATE TABLE IF NOT EXISTS so re-running
-- on a partially-recovered DB does nothing.
--
-- Sources: original migration commits (079b579 + 30f5908 hiring v2) for
-- the JobOpening-family; reverse-engineered from $queryRawUnsafe call
-- sites for OptionList / EmployeeBonus / AdhocLineItem / CandidateStage
-- / JobLocation (no original migration ever existed for these — they
-- were created hand-rolled in prod).
--
-- DATA LOSS: every row in these tables prior to 2026-06-12 is gone.
-- This script only restores the empty structure so HR routes stop 500ing.

-- ── JobOpeningQuestion (079b579: 20260529150000_job_opening_form_setup) ──
CREATE TABLE IF NOT EXISTS "JobOpeningQuestion" (
  "id"           SERIAL          PRIMARY KEY,
  "jobOpeningId" INTEGER         NOT NULL,
  "text"         TEXT            NOT NULL,
  "type"         TEXT            NOT NULL DEFAULT 'short_text',
  "options"      JSONB,
  "required"     BOOLEAN         NOT NULL DEFAULT false,
  "sortOrder"    INTEGER         NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  CONSTRAINT "JobOpeningQuestion_jobOpeningId_fkey"
    FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "JobOpeningQuestion_jobOpeningId_idx"
  ON "JobOpeningQuestion"("jobOpeningId");
CREATE INDEX IF NOT EXISTS "JobOpeningQuestion_sort_idx"
  ON "JobOpeningQuestion"("jobOpeningId", "sortOrder");

-- ── JobOpeningFieldConfig (same migration) ──
CREATE TABLE IF NOT EXISTS "JobOpeningFieldConfig" (
  "id"           SERIAL          PRIMARY KEY,
  "jobOpeningId" INTEGER         NOT NULL,
  "channel"      TEXT            NOT NULL,
  "fieldKey"     TEXT            NOT NULL,
  "visibility"   TEXT            NOT NULL DEFAULT 'optional',
  "sortOrder"    INTEGER         NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  CONSTRAINT "JobOpeningFieldConfig_jobOpeningId_fkey"
    FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "JobOpeningFieldConfig_unique_idx"
  ON "JobOpeningFieldConfig"("jobOpeningId", "channel", "fieldKey");
CREATE INDEX IF NOT EXISTS "JobOpeningFieldConfig_jobOpeningId_idx"
  ON "JobOpeningFieldConfig"("jobOpeningId");

-- ── JobOpeningRecruiterJoin (079b579: 20260529180000_job_wizard_v1) ──
CREATE TABLE IF NOT EXISTS "JobOpeningRecruiterJoin" (
  "jobOpeningId" INTEGER NOT NULL,
  "userId"       INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "JobOpeningRecruiterJoin_pkey" PRIMARY KEY ("jobOpeningId", "userId"),
  CONSTRAINT "JobOpeningRecruiterJoin_jobOpeningId_fkey"
    FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE,
  CONSTRAINT "JobOpeningRecruiterJoin_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "JobOpeningRecruiterJoin_userId_idx"
  ON "JobOpeningRecruiterJoin"("userId");

-- ── JobOpeningHiringManagerJoin (same migration) ──
CREATE TABLE IF NOT EXISTS "JobOpeningHiringManagerJoin" (
  "jobOpeningId" INTEGER NOT NULL,
  "userId"       INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "JobOpeningHiringManagerJoin_pkey" PRIMARY KEY ("jobOpeningId", "userId"),
  CONSTRAINT "JobOpeningHiringManagerJoin_jobOpeningId_fkey"
    FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE,
  CONSTRAINT "JobOpeningHiringManagerJoin_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "JobOpeningHiringManagerJoin_userId_idx"
  ON "JobOpeningHiringManagerJoin"("userId");

-- ── OptionList (reverse-engineered from /api/hr/options/route.ts) ──
-- Generic key/value dropdown. listKey identifies the dropdown
-- (department, jobTitle, etc.), value is the actual option string.
CREATE TABLE IF NOT EXISTS "OptionList" (
  "id"        SERIAL       PRIMARY KEY,
  "listKey"   TEXT         NOT NULL,
  "value"     TEXT         NOT NULL,
  "createdBy" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "OptionList_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL
);
-- Unique (listKey, value) so ON CONFLICT UPDATE works.
CREATE UNIQUE INDEX IF NOT EXISTS "OptionList_listKey_value_key"
  ON "OptionList"("listKey", "value");
CREATE INDEX IF NOT EXISTS "OptionList_listKey_idx"
  ON "OptionList"("listKey");

-- ── JobLocation (reverse-engineered from /api/hr/jobs/referrals/route.ts) ──
-- Per-job location lookup keyed by jobOpeningId; the referrals route
-- joins on l."jobOpeningId" and aggregates l.name. Lightweight alias
-- for JobOpeningLocation's public surface.
CREATE TABLE IF NOT EXISTS "JobLocation" (
  "id"           SERIAL       PRIMARY KEY,
  "jobOpeningId" INTEGER      NOT NULL,
  "name"         TEXT         NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "JobLocation_jobOpeningId_fkey"
    FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "JobLocation_jobOpeningId_idx"
  ON "JobLocation"("jobOpeningId");

-- ── EmployeeBonus (reverse-engineered from /api/hr/payroll/bonus/route.ts) ──
-- Used by the HR Payroll → Bonus tab. attachmentBlob holds the
-- optional supporting document (offer-letter, board-approval).
CREATE TABLE IF NOT EXISTS "EmployeeBonus" (
  "id"             SERIAL          PRIMARY KEY,
  "userId"         INTEGER         NOT NULL,
  "amount"         NUMERIC(14, 2)  NOT NULL,
  "reason"         TEXT,
  "effectiveDate"  TIMESTAMP(3)    NOT NULL,
  "bonusType"      TEXT            NOT NULL DEFAULT 'spot',
  "paymentStatus"  TEXT            NOT NULL DEFAULT 'pending',
  "createdBy"      INTEGER,
  "createdAt"      TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  "attachmentName" TEXT,
  "attachmentMime" TEXT,
  "attachmentBlob" BYTEA,
  CONSTRAINT "EmployeeBonus_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "EmployeeBonus_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "EmployeeBonus_userId_effectiveDate_idx"
  ON "EmployeeBonus"("userId", "effectiveDate");
CREATE INDEX IF NOT EXISTS "EmployeeBonus_effectiveDate_idx"
  ON "EmployeeBonus"("effectiveDate");

-- ── AdhocLineItem (reverse-engineered from /api/hr/payroll/adhoc/route.ts) ──
-- HR Payroll → Adhoc payments / deductions. month is 0-11, kind is
-- "payment" or "deduction", type is a short label.
CREATE TABLE IF NOT EXISTS "AdhocLineItem" (
  "id"        SERIAL          PRIMARY KEY,
  "userId"    INTEGER         NOT NULL,
  "month"     INTEGER         NOT NULL,
  "year"      INTEGER         NOT NULL,
  "kind"      TEXT            NOT NULL,
  "type"      TEXT,
  "amount"    NUMERIC(14, 2)  NOT NULL,
  "comment"   TEXT,
  "createdBy" INTEGER,
  "createdAt" TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  CONSTRAINT "AdhocLineItem_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "AdhocLineItem_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "AdhocLineItem_userId_month_year_idx"
  ON "AdhocLineItem"("userId", "year", "month");
CREATE INDEX IF NOT EXISTS "AdhocLineItem_year_month_kind_idx"
  ON "AdhocLineItem"("year", "month", "kind");

-- ── CandidateStage (reverse-engineered: legacy lookup the stages
-- route only checks via information_schema before querying. Safer
-- to restore as empty than leave the existence check toggling).
CREATE TABLE IF NOT EXISTS "CandidateStage" (
  "id"             SERIAL       PRIMARY KEY,
  "candidateId"    INTEGER,
  "jobApplicationId" INTEGER,
  "stageId"        INTEGER      NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "CandidateStage_stageId_idx"
  ON "CandidateStage"("stageId");
