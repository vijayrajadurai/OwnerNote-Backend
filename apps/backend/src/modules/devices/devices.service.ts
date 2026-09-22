import { prisma } from "../../db/prisma";

export async function upsertDeviceToken(userId: string, token: string, platform: string) {
  return prisma.deviceToken.upsert({
    where: { token },
    create: { userId, token, platform },
    update: { userId, platform },
  });
}

export async function deleteDeviceToken(userId: string, token: string): Promise<void> {
  await prisma.deviceToken.deleteMany({ where: { userId, token } });
}

export async function listTokensForUser(userId: string): Promise<string[]> {
  const rows = await prisma.deviceToken.findMany({ where: { userId }, select: { token: true } });
  return rows.map((row) => row.token);
}

export async function deleteTokenValue(token: string): Promise<void> {
  await prisma.deviceToken.deleteMany({ where: { token } });
}
