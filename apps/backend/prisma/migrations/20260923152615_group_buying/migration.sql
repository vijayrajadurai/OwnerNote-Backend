-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('GPS', 'MANUAL');

-- CreateEnum
CREATE TYPE "GroupBuyingRequestStatus" AS ENUM ('ACTIVE', 'MATCHED', 'JOINED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GroupBuyingGroupStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "GroupBuyingMemberStatus" AS ENUM ('PENDING', 'JOINED', 'CONFIRMED', 'DECLINED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "areaLabel" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "locationSource" "LocationSource",
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "GroupBuyingRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "requiredDate" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "areaLabel" TEXT NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL,
    "status" "GroupBuyingRequestStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupBuyingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupBuyingGroup" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requiredDate" TEXT NOT NULL,
    "areaLabel" TEXT NOT NULL,
    "status" "GroupBuyingGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupBuyingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupBuyingMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "status" "GroupBuyingMemberStatus" NOT NULL DEFAULT 'PENDING',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupBuyingMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupBuyingRequest_productId_status_requiredDate_idx" ON "GroupBuyingRequest"("productId", "status", "requiredDate");

-- CreateIndex
CREATE INDEX "GroupBuyingRequest_businessId_idx" ON "GroupBuyingRequest"("businessId");

-- CreateIndex
CREATE INDEX "GroupBuyingMember_groupId_idx" ON "GroupBuyingMember"("groupId");

-- CreateIndex
CREATE INDEX "GroupBuyingMember_requestId_idx" ON "GroupBuyingMember"("requestId");

-- CreateIndex
CREATE INDEX "GroupBuyingMember_businessId_idx" ON "GroupBuyingMember"("businessId");

-- AddForeignKey
ALTER TABLE "GroupBuyingRequest" ADD CONSTRAINT "GroupBuyingRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupBuyingMember" ADD CONSTRAINT "GroupBuyingMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GroupBuyingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
