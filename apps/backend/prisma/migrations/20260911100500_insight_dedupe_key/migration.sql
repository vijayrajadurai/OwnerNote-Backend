-- AiInsight rows are a regenerable cache of businessInsightEngine output,
-- not source-of-truth business data, so it's safe to clear them before
-- adding the new required dedupe key column.
DELETE FROM "AiInsight";

ALTER TABLE "AiInsight" ADD COLUMN "dedupeKey" TEXT NOT NULL;

CREATE UNIQUE INDEX "AiInsight_businessId_type_dedupeKey_key" ON "AiInsight"("businessId", "type", "dedupeKey");
