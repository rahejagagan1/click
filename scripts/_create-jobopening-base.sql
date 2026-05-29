-- One-shot bootstrap for production: create the base JobOpening +
-- JobApplication tables that should have existed before any of the
-- hiring migrations ran. The schema captures their ORIGINAL columns
-- only — every later migration (hiring_keka_parity, publish_workflow,
-- priority_flag, jd_attachment, wizard_v1, archive_reason, etc.) uses
-- ADD COLUMN IF NOT EXISTS so they'll layer on top cleanly.
--
-- Safe to run multiple times — every statement is IF NOT EXISTS.

-- ── JobOpening (base) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "JobOpening" (
  "id"          SERIAL          PRIMARY KEY,
  "title"       TEXT            NOT NULL,
  "department"  TEXT,
  "location"    TEXT,
  "description" TEXT,
  "isOpen"      BOOLEAN         NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3)    NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "JobOpening_title_key" ON "JobOpening" ("title");
CREATE INDEX        IF NOT EXISTS "JobOpening_isOpen_idx"  ON "JobOpening" ("isOpen");

-- ── JobApplication (base) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "JobApplication" (
  "id"              SERIAL          PRIMARY KEY,
  "jobOpeningId"    INTEGER         NOT NULL,
  "fullName"        TEXT            NOT NULL,
  "email"           TEXT            NOT NULL,
  "phone"           TEXT,
  "coverLetter"     TEXT,
  "linkedinUrl"     TEXT,
  "portfolioUrl"    TEXT,
  "experienceYears" INTEGER,
  "currentCompany"  TEXT,
  "noticePeriod"    TEXT,
  "resumeFileName"  TEXT,
  "resumeUrl"       TEXT,
  "status"          TEXT            NOT NULL DEFAULT 'new',
  "hrNotes"         TEXT,
  "createdAt"       TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP(3)    NOT NULL DEFAULT NOW()
);

-- FK + indexes (skipped if they already landed)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'JobApplication_jobOpeningId_fkey'
  ) THEN
    ALTER TABLE "JobApplication"
      ADD CONSTRAINT "JobApplication_jobOpeningId_fkey"
      FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "JobApplication_jobOpeningId_idx" ON "JobApplication" ("jobOpeningId");
CREATE INDEX IF NOT EXISTS "JobApplication_status_idx"       ON "JobApplication" ("status");
CREATE INDEX IF NOT EXISTS "JobApplication_createdAt_idx"    ON "JobApplication" ("createdAt");
