import type { ErrorCode } from "./error-codes";

/**
 * Throw this from services/controllers for any expected/handled error condition. Caught by
 * `error.middleware.ts` and rendered into the standard `{ success: false, error: {...} }`
 * envelope (docs/architecture/DEVELOPMENT_PLAN.md Section 6). Anything NOT thrown as an
 * AppError is treated as an unexpected bug and rendered as a generic 500 INTERNAL_ERROR
 * (with the real error logged server-side, never leaked to the client).
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static notFound(code: ErrorCode, message: string): AppError {
    return new AppError(404, code, message);
  }

  static conflict(code: ErrorCode, message: string, details?: unknown): AppError {
    return new AppError(409, code, message, details);
  }

  static badRequest(code: ErrorCode, message: string, details?: unknown): AppError {
    return new AppError(400, code, message, details);
  }
}
