ALTER TABLE "Campaign" ADD COLUMN "requestKey" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "contentSnapshot" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Campaign" ADD COLUMN "dryRun" BOOLEAN NOT NULL DEFAULT true;
UPDATE "Campaign" SET "contentSnapshot" = (SELECT "finalText" FROM "Job" WHERE "Job"."id" = "Campaign"."jobId");
CREATE UNIQUE INDEX "Campaign_requestKey_key" ON "Campaign"("requestKey");
CREATE TABLE "ContentDraft" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "sourceData" TEXT NOT NULL,
  "instructions" TEXT NOT NULL DEFAULT '',
  "groupIdsJson" TEXT NOT NULL DEFAULT '[]',
  "finalText" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "chatUrl" TEXT,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
