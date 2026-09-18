import type { Request, Response } from "express";
import { getDashboardSnapshot } from "./dashboard.service";
import { UnauthorizedError } from "../../utils/errors";

export async function getDashboard(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new UnauthorizedError();
  const snapshot = await getDashboardSnapshot(req.auth.userId);
  res.status(200).json({ data: snapshot });
}
