import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "../../utils/errors";
import * as devicesService from "./devices.service";
import * as pushService from "./push.service";

const registerSchema = z.object({
  token: z.string().min(32).max(4096),
  platform: z.enum(["ANDROID", "IOS", "WEB"]).default("ANDROID"),
});

const unregisterSchema = z.object({
  token: z.string().min(32).max(4096),
});

const adminPushSchema = z.object({
  userId: z.string().uuid().optional(),
  phone: z.string().min(8).optional(),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  data: z.record(z.string()).optional(),
});

function requireUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth.userId;
}

export async function registerDevice(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const { token, platform } = registerSchema.parse(req.body);
  const device = await devicesService.upsertDeviceToken(userId, token, platform);
  res.status(200).json({
    data: {
      id: device.id,
      platform: device.platform,
      updatedAt: device.updatedAt,
    },
  });
}

export async function unregisterDevice(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const { token } = unregisterSchema.parse(req.body);
  await devicesService.deleteDeviceToken(userId, token);
  res.status(200).json({ data: { ok: true } });
}

export async function adminSendPush(req: Request, res: Response): Promise<void> {
  const body = adminPushSchema.parse(req.body);
  let userId = body.userId;
  if (!userId && body.phone) {
    const raw = body.phone.trim();
    const { prisma } = await import("../../db/prisma");
    const user = await prisma.user.findFirst({
      where: { OR: [{ phone: raw }, { phone: raw.startsWith("+") ? raw : `+91${raw}` }] },
    });
    userId = user?.id;
  }
  if (!userId) {
    throw new ValidationError("Provide userId or phone");
  }
  const result = await pushService.sendPushToUser(userId, {
    title: body.title,
    body: body.body,
    data: body.data,
  });
  res.status(200).json({ data: { userId, ...result } });
}
