import type { NextFunction, Request, Response } from "express";
import { verifyAuthToken, type AuthTokenPayload } from "../utils/jwt";
import { UnauthorizedError, ForbiddenError } from "../utils/errors";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing bearer token");
  }

  const token = header.slice("Bearer ".length);
  try {
    req.auth = verifyAuthToken(token);
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
  next();
}

export function requireRole(...roles: AuthTokenPayload["role"][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      throw new ForbiddenError("You do not have permission to perform this action");
    }
    next();
  };
}
