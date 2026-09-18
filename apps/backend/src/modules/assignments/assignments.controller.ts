import type { Request, Response } from "express";
import { z } from "zod";
import * as assignmentsService from "./assignments.service";
import { UnauthorizedError } from "../../utils/errors";

function requireAdminUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth.userId;
}

const assignSchema = z.object({ salesOfficerId: z.string().uuid() });

export async function assignLead(req: Request, res: Response): Promise<void> {
  const adminUserId = requireAdminUserId(req);
  const { salesOfficerId } = assignSchema.parse(req.body);
  const assignment = await assignmentsService.assignLead(adminUserId, req.params.id, salesOfficerId);
  res.status(200).json({ data: assignment });
}

export async function unassignLead(req: Request, res: Response): Promise<void> {
  const adminUserId = requireAdminUserId(req);
  const assignment = await assignmentsService.unassignLead(adminUserId, req.params.id);
  res.status(200).json({ data: assignment });
}

export async function getAssignmentHistory(req: Request, res: Response): Promise<void> {
  const history = await assignmentsService.getAssignmentHistory(req.params.id);
  res.status(200).json({ data: history });
}
