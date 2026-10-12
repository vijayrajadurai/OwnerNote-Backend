-- CreateEnum
CREATE TYPE "KaiMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "KaiMemoryKind" AS ENUM ('PREFERENCE', 'ALIAS', 'NOTE');

-- CreateEnum
CREATE TYPE "KaiMemoryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "KaiCorrectionStatus" AS ENUM ('UNVERIFIED', 'MATCHES_RECORDS', 'CONFLICTS_WITH_RECORDS');

-- CreateEnum
CREATE TYPE "KaiActionKind" AS ENUM ('ADD_CREDIT', 'ADD_DEBIT', 'RECORD_PAYMENT', 'SAVE_MEMORY');

-- CreateEnum
CREATE TYPE "KaiActionStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "KaiConversation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "summary" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KaiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KaiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "role" "KaiMessageRole" NOT NULL,
    "text" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "intent" TEXT,
    "engine" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KaiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KaiMemory" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "KaiMemoryKind" NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "status" "KaiMemoryStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KaiMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KaiCorrection" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT,
    "said" TEXT NOT NULL,
    "previous" TEXT,
    "source" TEXT NOT NULL,
    "status" "KaiCorrectionStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KaiCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KaiActionDraft" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "kind" "KaiActionKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "warnings" JSONB,
    "status" "KaiActionStatus" NOT NULL DEFAULT 'PENDING',
    "confirmKey" TEXT,
    "result" JSONB,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KaiActionDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KaiFeedback" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "allowTraining" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KaiFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KaiConversation_businessId_lastMessageAt_idx" ON "KaiConversation"("businessId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "KaiMessage_conversationId_createdAt_idx" ON "KaiMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "KaiMessage_businessId_createdAt_idx" ON "KaiMessage"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "KaiMemory_businessId_status_kind_idx" ON "KaiMemory"("businessId", "status", "kind");

-- CreateIndex
CREATE INDEX "KaiCorrection_businessId_createdAt_idx" ON "KaiCorrection"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KaiActionDraft_confirmKey_key" ON "KaiActionDraft"("confirmKey");

-- CreateIndex
CREATE INDEX "KaiActionDraft_businessId_status_idx" ON "KaiActionDraft"("businessId", "status");

-- CreateIndex
CREATE INDEX "KaiFeedback_businessId_createdAt_idx" ON "KaiFeedback"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KaiFeedback_messageId_userId_key" ON "KaiFeedback"("messageId", "userId");

-- AddForeignKey
ALTER TABLE "KaiConversation" ADD CONSTRAINT "KaiConversation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KaiMessage" ADD CONSTRAINT "KaiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "KaiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KaiMemory" ADD CONSTRAINT "KaiMemory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KaiCorrection" ADD CONSTRAINT "KaiCorrection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KaiActionDraft" ADD CONSTRAINT "KaiActionDraft_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KaiFeedback" ADD CONSTRAINT "KaiFeedback_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KaiFeedback" ADD CONSTRAINT "KaiFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "KaiMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
