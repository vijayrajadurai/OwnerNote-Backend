import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listReminders, createReminder, markReminderDone } from "./reminders.controller";

export const remindersRouter = Router();

remindersRouter.use(requireAuth);
remindersRouter.get("/", asyncHandler(listReminders));
remindersRouter.post("/", asyncHandler(createReminder));
remindersRouter.post("/:id/done", asyncHandler(markReminderDone));
