-- CreateEnum
CREATE TYPE "DiscoverItemType" AS ENUM ('PRODUCT', 'OFFER', 'EVENT', 'CELEBRATION');

-- CreateTable
CREATE TABLE "DiscoverItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "DiscoverItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "priceLabel" TEXT,
    "validUntil" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoverItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoverItem_businessId_type_isActive_idx" ON "DiscoverItem"("businessId", "type", "isActive");

-- CreateIndex
CREATE INDEX "DiscoverItem_businessId_sortOrder_idx" ON "DiscoverItem"("businessId", "sortOrder");

-- AddForeignKey
ALTER TABLE "DiscoverItem" ADD CONSTRAINT "DiscoverItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
