-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('CASH_PRESSURE', 'PAYMENT_DUE', 'COLLECTION_DUE', 'BUSINESS_HEALTH', 'SEASONAL_PREPARATION', 'HISTORICAL_PATTERN', 'PURCHASE_PATTERN', 'UPCOMING_NEED');

-- CreateEnum
CREATE TYPE "InsightSeverity" AS ENUM ('INFO', 'WATCH', 'PRESSURE', 'HIGH_PRESSURE');

-- CreateEnum
CREATE TYPE "BusinessEventSource" AS ENUM ('CSV_IMPORT', 'XLSX_IMPORT', 'ACCOUNTING_EXPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "BusinessEventType" AS ENUM ('STOCK_PURCHASE', 'SALE', 'EXPENSE', 'OTHER');

-- CreateTable
CREATE TABLE "AiInsight" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "InsightType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "InsightSeverity" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sourceRefs" JSONB,
    "validUntil" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "eventType" "BusinessEventType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" "BusinessEventSource" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiInsight_businessId_createdAt_idx" ON "AiInsight"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AiInsight_businessId_type_idx" ON "AiInsight"("businessId", "type");

-- CreateIndex
CREATE INDEX "BusinessEvent_businessId_eventType_occurredAt_idx" ON "BusinessEvent"("businessId", "eventType", "occurredAt");

-- AddForeignKey
ALTER TABLE "AiInsight" ADD CONSTRAINT "AiInsight_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessEvent" ADD CONSTRAINT "BusinessEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
