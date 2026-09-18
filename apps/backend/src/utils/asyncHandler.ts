import type { NextFunction, Request, Response } from "express";

type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

export function asyncHandler(handler: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}
