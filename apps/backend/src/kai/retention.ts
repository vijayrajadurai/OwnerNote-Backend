import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";

/**
 * Kai keeps chat history for KAI_HISTORY_RETENTION_DAYS (default 180) and then deletes it: conversations (with their
 * messages and feedback), finished drafts and corrections. Approved memory stays until the owner deletes it.
 */
export async function purgeKaiHistory(now: Date = new Date()): Promise<{ conversations: number; drafts: number; corrections: number }> {
  const cutoff = new Date(now.getTime() - env.KAI_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const [conversations, drafts, corrections] = await prisma.$transaction([
    prisma.kaiConversation.deleteMany({ where: { lastMessageAt: { lt: cutoff } } }),
    prisma.kaiActionDraft.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.kaiCorrection.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);
  return { conversations: conversations.count, drafts: drafts.count, corrections: corrections.count };
}

/** Runs the purge now and once a day (never keeps the process alive on its own). */
export function scheduleKaiRetention(): void {
  const run = () =>
    purgeKaiHistory()
      .then((r) => logger.info(r, "Kai history retention purge"))
      .catch((err) => logger.error({ err }, "Kai history retention purge failed"));
  void run();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}
