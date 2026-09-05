import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/app-error";
import { ErrorCode } from "../lib/error-codes";
import { logger } from "../lib/logger";

/**
 * Centralized error handler — every module throws `AppError` (or lets Prisma/unexpected errors
 * bubble up) and this is the single place that turns any of that into the standard
 * `{ success: false, error: { code, message } }` envelope (Section 6 of the plan doc).
 *
 * Must be registered LAST, after all routes.
 */
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  // Prisma's own "unique constraint violated" — should be rare since duplicate checks happen
  // in services first, but this is a safety net, not the primary mechanism (see Locked
  // Decision 1.3 for why most uniqueness is enforced at the app layer, not the DB layer).
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: "A record with these unique fields already exists",
      },
    });
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
  res.status(500).json({
    success: false,
    error: { code: ErrorCode.INTERNAL_ERROR, message: "Something went wrong" },
  });
}
