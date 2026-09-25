-- CreateEnum
CREATE TYPE "GroupBuyingInviteStatus" AS ENUM ('PENDING', 'INTERESTED', 'NOT_INTERESTED');

-- CreateTable
CREATE TABLE "GroupBuyingInvite" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" "GroupBuyingInviteStatus" NOT NULL DEFAULT 'PENDING',
    "quantity" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupBuyingInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupBuyingInvite_businessId_status_idx" ON "GroupBuyingInvite"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GroupBuyingInvite_requestId_businessId_key" ON "GroupBuyingInvite"("requestId", "businessId");

-- AddForeignKey
ALTER TABLE "GroupBuyingInvite" ADD CONSTRAINT "GroupBuyingInvite_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "GroupBuyingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupBuyingInvite" ADD CONSTRAINT "GroupBuyingInvite_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
