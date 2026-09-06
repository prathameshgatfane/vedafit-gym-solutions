import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/app-error";
import { ErrorCode } from "../lib/error-codes";
import { getAuth } from "./auth.middleware";

/**
 * Enforces Section 6's multi-tenancy rule: `organizationId` and `branchId` come from the JWT,
 * and any client-supplied value for them is validated-and-rejected rather than trusted.
 *
 * "Client-supplied" covers all three places a caller can put one:
 *   - the URL   (`/api/v1/organizations/:organizationId/...`)
 *   - the body  (`{ "organizationId": "..." }`)
 *   - the query (`?organizationId=...`)
 *
 * Rules:
 *   - Any supplied `organizationId` that isn't the caller's own org → 403 ORG_MISMATCH. This is
 *     what makes org A's token useless against org B's URLs, on every module at once.
 *   - Any supplied `branchId` from a *branch-scoped* caller that isn't their own branch →
 *     403 BRANCH_MISMATCH. Org-wide callers (OWNER/ADMIN/ACCOUNTANT, `branchId: null`) may name
 *     any branch, because assigning staff and members across branches is their job — the service
 *     layer still checks the branch belongs to the caller's org.
 *
 * Must run after `authenticate`.
 */
export function tenantScope(req: Request, _res: Response, next: NextFunction): void {
  let auth;
  try {
    auth = getAuth(req);
  } catch (err) {
    next(err);
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;

  const suppliedOrgIds = [req.params.organizationId, body.organizationId, query.organizationId];
  for (const supplied of suppliedOrgIds) {
    if (typeof supplied === "string" && supplied !== auth.organizationId) {
      next(
        new AppError(
          403,
          ErrorCode.ORG_MISMATCH,
          "Request targets an organization other than the authenticated one",
        ),
      );
      return;
    }
  }

  if (auth.branchId !== null) {
    const suppliedBranchIds = [req.params.branchId, body.branchId, query.branchId];
    for (const supplied of suppliedBranchIds) {
      if (typeof supplied === "string" && supplied !== auth.branchId) {
        next(
          new AppError(
            403,
            ErrorCode.BRANCH_MISMATCH,
            "Request targets a branch other than the authenticated one",
          ),
        );
        return;
      }
    }
  }

  next();
}
