import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/app-error";
import { ErrorCode } from "../lib/error-codes";
import { prisma } from "../lib/prisma";
import { getAuth } from "./auth.middleware";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Suspended gyms cannot mutate tenant data with a still-valid access JWT.
 * Login and refresh are already blocked. GET /auth/me stays on the auth router
 * and remains allowed until the access token expires (Phase 15.7).
 * Reads under /organizations stay allowed for the same TTL window.
 */
export async function rejectSuspendedOrganizationWrites(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  try {
    const auth = getAuth(req);
    const org = await prisma.organization.findUnique({
      where: { id: auth.organizationId },
      select: { status: true },
    });
    if (!org || org.status !== "ACTIVE") {
      next(
        new AppError(403, ErrorCode.ACCOUNT_INACTIVE, "This organization is suspended"),
      );
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
