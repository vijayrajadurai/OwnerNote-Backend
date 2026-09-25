-- AlterTable
ALTER TABLE "DailyCashReport" ADD COLUMN "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DailyCashOpening" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCashOpening_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyCashOpening_businessId_date_idx" ON "DailyCashOpening"("businessId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCashOpening_businessId_date_key" ON "DailyCashOpening"("businessId", "date");

-- AddForeignKey
ALTER TABLE "DailyCashOpening" ADD CONSTRAINT "DailyCashOpening_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
