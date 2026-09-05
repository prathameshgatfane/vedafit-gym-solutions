import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { AppError } from "../lib/app-error";
import { ErrorCode } from "../lib/error-codes";

type RequestPart = "body" | "query" | "params";

/**
 * Validates `req[part]` against a Zod schema. On success, replaces `req[part]` with the
 * parsed (and thus coerced/defaulted) value. On failure, throws a single `AppError` with every
 * field error listed — never a raw ZodError leaking to the client.
 */
export function validate(schema: ZodSchema, part: RequestPart = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      next(
        AppError.badRequest(
          ErrorCode.VALIDATION_ERROR,
          "Request validation failed",
          fieldErrors,
        ),
      );
      return;
    }

    // Zod's parsed output can have a different (narrower/coerced) shape than the raw input —
    // that's the point of validating, so downstream handlers see clean data.
    (req as Record<RequestPart, unknown>)[part] = result.data;
    next();
  };
}
