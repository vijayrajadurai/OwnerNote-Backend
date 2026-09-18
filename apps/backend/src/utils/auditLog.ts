import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

/**
 * Minimal audit trail for important admin/FO actions. Fire-and-forget by
 * design (never blocks or fails the action it's recording) — an audit
 * write failing must not stop a lead assignment or status change from
 * succeeding.
 */
export async function logAudit(
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId,
        action,
        entityType,
        entityId,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch {
    // Never let audit logging break the primary action.
  }
}
