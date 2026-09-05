import type { NextFunction, Request, Response } from "express";

/**
 * Wraps an async Express route handler so a rejected promise is forwarded to `next()` (and thus
 * to `error.middleware.ts`) instead of crashing the process / hanging the request. Generic so
 * controllers can type `req` with a narrower `Request<Params>` (route params are guaranteed
 * present at runtime once `validate(schema, "params")` has run first in the route chain).
 */
export function asyncHandler<Req extends Request>(
  handler: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Req, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
