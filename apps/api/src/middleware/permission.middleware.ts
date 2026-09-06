import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/app-error";
import { ErrorCode } from "../lib/error-codes";
import { prisma } from "../lib/prisma";
import { getAuth } from "./auth.middleware";

/**
 * Gate a route on the caller's role → permission mapping (Section 4.2), checked *before* the
 * handler runs. Never `isAdmin`-style role-name checks — see Section 8's explicit don'ts.
 *
 * Passing several keys means "any one of these is enough" (e.g. a read route reachable by both
 * `members.view` and `members.update` holders).
 *
 * The lookup is one indexed query per request. That's deliberate for now: a cached role→permission
 * map would go stale the moment `roles.manage` edits a role, and the shared cache to invalidate it
 * properly (Redis) isn't introduced until Phase 12.
 */
export function requirePermission(...anyOf: string[]) {
  if (anyOf.length === 0) {
    throw new Error("requirePermission() needs at least one permission key");
  }

  return async function permissionGuard(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const auth = getAuth(req);

      const granted = await prisma.rolePermission.findFirst({
        where: { roleId: auth.roleId, permission: { key: { in: anyOf } } },
        select: { permissionId: true },
      });

      if (!granted) {
        next(
          new AppError(
            403,
            ErrorCode.PERMISSION_DENIED,
            `This role lacks the required permission: ${anyOf.join(" or ")}`,
          ),
        );
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
