import type { Request, Response } from "express";
import { z } from "zod";
import * as remindersService from "./reminders.service";
import * as businessService from "../business/business.service";
import * as pushService from "../devices/push.service";
import { UnauthorizedError } from "../../utils/errors";

const createReminderSchema = z.object({
  title: z.string().min(2).max(200),
  dueDate: z.string().datetime(),
});

async function requireBusinessId(req: Request): Promise<string> {
  if (!req.auth) throw new UnauthorizedError();
  const business = await businessService.getBusinessForUser(req.auth.userId);
  return business.id;
}

export async function listReminders(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const reminders = await remindersService.listReminders(businessId);
  res.status(200).json({ data: reminders });
}

export async function createReminder(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const { title, dueDate } = createReminderSchema.parse(req.body);
  const reminder = await remindersService.createReminder(businessId, title, dueDate);
  void pushService
    .sendPushToUser(req.auth!.userId, {
      title: "Owner Note reminder",
      body: title,
      data: { type: "reminder", reminderId: reminder.id },
    })
    .catch(() => undefined);
  res.status(201).json({ data: reminder });
}

export async function markReminderDone(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const reminder = await remindersService.markReminderDone(businessId, req.params.id);
  res.status(200).json({ data: reminder });
}
