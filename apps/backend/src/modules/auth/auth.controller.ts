import type { Request, Response } from "express";
import { z } from "zod";
import * as authService from "./auth.service";
import { UnauthorizedError } from "../../utils/errors";

const sendOtpSchema = z.object({
  phone: z.string().min(8),
});

const verifyOtpSchema = z.object({
  phone: z.string().min(8),
  code: z.string().length(6),
});

const testLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const firebaseLoginSchema = z.object({
  idToken: z.string().min(20),
});

export async function sendOtp(req: Request, res: Response): Promise<void> {
  const { phone } = sendOtpSchema.parse(req.body);
  const result = await authService.requestOtp(phone);
  res.status(200).json({ data: result });
}

export async function verifyOtpHandler(req: Request, res: Response): Promise<void> {
  const { phone, code } = verifyOtpSchema.parse(req.body);
  const result = await authService.verifyOtp(phone, code);
  res.status(200).json({ data: result });
}

export async function firebaseLoginHandler(req: Request, res: Response): Promise<void> {
  const { idToken } = firebaseLoginSchema.parse(req.body);
  const result = await authService.loginWithFirebaseIdToken(idToken);
  res.status(200).json({ data: result });
}

export async function testLoginHandler(req: Request, res: Response): Promise<void> {
  const { username, password } = testLoginSchema.parse(req.body);
  const result = await authService.testLogin(username, password);
  res.status(200).json({ data: result });
}

// Lets any client (web dashboard included) discover the logged-in user's
// role after auth without decoding the JWT itself.
export async function getMe(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new UnauthorizedError();
  const me = await authService.getMe(req.auth.userId);
  res.status(200).json({ data: me });
}
