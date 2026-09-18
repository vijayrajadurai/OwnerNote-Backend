-- CreateEnum
CREATE TYPE "FundingOpportunityType" AS ENUM ('WORKING_CAPITAL', 'SEASONAL_STOCK', 'SUPPLIER_PAYMENT', 'LARGE_PURCHASE', 'EXPANSION', 'LARGE_ORDER', 'OTHER');

-- CreateEnum
CREATE TYPE "FundingUrgency" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "FundingOpportunityStatus" AS ENUM ('DETECTED', 'SHOWN', 'INTERESTED', 'NOT_NOW', 'EXPIRED', 'CONVERTED_TO_LEAD');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'QUALIFIED', 'ASSIGNED', 'CONTACTED', 'VISIT_SCHEDULED', 'VISITED', 'APPLICATION_STARTED', 'APPROVED', 'DISBURSED', 'NOT_INTERESTED', 'REJECTED', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('FUNDING_OPPORTUNITY', 'MANUAL');

-- CreateEnum
CREATE TYPE "UserIntent" AS ENUM ('EXPLORE_OPTIONS', 'TALK_TO_SOMEONE');

-- CreateTable
CREATE TABLE "FundingOpportunity" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "FundingOpportunityType" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "estimatedRequirement" DECIMAL(14,2),
    "estimatedAvailableCash" DECIMAL(14,2),
    "estimatedGap" DECIMAL(14,2),
    "urgency" "FundingUrgency" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "signalScore" INTEGER NOT NULL,
    "sourceSignals" JSONB NOT NULL,
    "status" "FundingOpportunityStatus" NOT NULL DEFAULT 'DETECTED',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "FundingOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanLead" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "ownerName" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "businessCategory" "BusinessCategory" NOT NULL,
    "businessDurationYears" INTEGER,
    "city" TEXT NOT NULL,
    "fundingRequirementMin" DECIMAL(14,2),
    "fundingRequirementMax" DECIMAL(14,2),
    "workingCapitalRequirement" DECIMAL(14,2),
    "fundingReason" TEXT NOT NULL,
    "preferredCallbackTime" TEXT,
    "userIntent" "UserIntent" NOT NULL,
    "aiDetectedReason" TEXT NOT NULL,
    "leadScore" INTEGER NOT NULL,
    "leadScoreExplanation" JSONB NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "source" "LeadSource" NOT NULL DEFAULT 'FUNDING_OPPORTUNITY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingOpportunity_businessId_status_idx" ON "FundingOpportunity"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FundingOpportunity_businessId_type_dedupeKey_key" ON "FundingOpportunity"("businessId", "type", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "LoanLead_opportunityId_key" ON "LoanLead"("opportunityId");

-- CreateIndex
CREATE INDEX "LoanLead_businessId_idx" ON "LoanLead"("businessId");

-- CreateIndex
CREATE INDEX "LoanLead_status_idx" ON "LoanLead"("status");

-- AddForeignKey
ALTER TABLE "FundingOpportunity" ADD CONSTRAINT "FundingOpportunity_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanLead" ADD CONSTRAINT "LoanLead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanLead" ADD CONSTRAINT "LoanLead_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "FundingOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
