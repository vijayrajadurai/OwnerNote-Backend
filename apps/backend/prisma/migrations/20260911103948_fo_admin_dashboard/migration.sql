-- CreateEnum
CREATE TYPE "VisitOutcome" AS ENUM ('SCHEDULED', 'VISITED', 'CUSTOMER_INTERESTED', 'CUSTOMER_NOT_INTERESTED', 'FOLLOW_UP_REQUIRED', 'APPLICATION_STARTED', 'NOT_CONTACTABLE', 'CANCELLED');

-- CreateTable
CREATE TABLE "SalesOfficerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "territory" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOfficerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "salesOfficerId" TEXT NOT NULL,
    "assignedByUserId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitRecord" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "salesOfficerId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "visitedAt" TIMESTAMP(3),
    "outcome" "VisitOutcome" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesOfficerProfile_userId_key" ON "SalesOfficerProfile"("userId");

-- CreateIndex
CREATE INDEX "SalesOfficerProfile_active_idx" ON "SalesOfficerProfile"("active");

-- CreateIndex
CREATE INDEX "LeadAssignment_leadId_active_idx" ON "LeadAssignment"("leadId", "active");

-- CreateIndex
CREATE INDEX "LeadAssignment_salesOfficerId_active_idx" ON "LeadAssignment"("salesOfficerId", "active");

-- CreateIndex
CREATE INDEX "VisitRecord_leadId_idx" ON "VisitRecord"("leadId");

-- CreateIndex
CREATE INDEX "VisitRecord_salesOfficerId_nextFollowUpAt_idx" ON "VisitRecord"("salesOfficerId", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "SalesOfficerProfile" ADD CONSTRAINT "SalesOfficerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LoanLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_salesOfficerId_fkey" FOREIGN KEY ("salesOfficerId") REFERENCES "SalesOfficerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRecord" ADD CONSTRAINT "VisitRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LoanLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRecord" ADD CONSTRAINT "VisitRecord_salesOfficerId_fkey" FOREIGN KEY ("salesOfficerId") REFERENCES "SalesOfficerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
