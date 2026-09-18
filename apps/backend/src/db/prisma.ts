import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

// Reuse a single PrismaClient across hot reloads in dev to avoid exhausting connections.
export const prisma = global.__prisma__ ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma__ = prisma;
}
