import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/app-error";
import { ErrorCode } from "../lib/error-codes";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/jwt";

/**
 * Request-scoped identity, populated by `authenticate` from the access token and by nothing
 * else. Read it through `getAuth(req)` rather than touching `req.auth` directly so a missing
 * context is a loud 401 instead of a silent `undefined`.
 */
export type AuthContext = AccessTokenPayload;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Requires a valid `Authorization: Bearer <token>` header and attaches the decoded claims to
 * `req.auth`. Does no tenancy or permission checking — that's tenant.middleware / permission.middleware,
 * which run after this one.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    next(
      new AppError(
        401,
        ErrorCode.UNAUTHENTICATED,
        "Missing or malformed Authorization header",
      ),
    );
    return;
  }

  try {
    req.auth = verifyAccessToken(header.slice("Bearer ".length).trim());
    next();
  } catch (err) {
    next(err);
  }
}

/** Narrows `req.auth` to a definite value. Throws if `authenticate` didn't run first. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw new AppError(401, ErrorCode.UNAUTHENTICATED, "Authentication required");
  }
  return req.auth;
}
