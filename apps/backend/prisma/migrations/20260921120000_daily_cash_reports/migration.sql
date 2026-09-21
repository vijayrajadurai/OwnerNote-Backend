-- CreateEnum
CREATE TYPE "DailyCashEntryType" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "DailyCashPaymentMode" AS ENUM ('CASH', 'UPI');

-- CreateTable
CREATE TABLE "DailyCashReport" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "totalIn" DECIMAL(14,2) NOT NULL,
    "totalOut" DECIMAL(14,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "cashIn" DECIMAL(14,2) NOT NULL,
    "cashOut" DECIMAL(14,2) NOT NULL,
    "upiIn" DECIMAL(14,2) NOT NULL,
    "upiOut" DECIMAL(14,2) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyCashReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCashReportEntry" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "type" "DailyCashEntryType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentMode" "DailyCashPaymentMode" NOT NULL,
    "note" TEXT,
    "entryCreatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCashReportEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyCashReport_businessId_date_idx" ON "DailyCashReport"("businessId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCashReport_businessId_date_key" ON "DailyCashReport"("businessId", "date");

-- CreateIndex
CREATE INDEX "DailyCashReportEntry_reportId_idx" ON "DailyCashReportEntry"("reportId");

-- AddForeignKey
ALTER TABLE "DailyCashReport" ADD CONSTRAINT "DailyCashReport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCashReportEntry" ADD CONSTRAINT "DailyCashReportEntry_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyCashReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
