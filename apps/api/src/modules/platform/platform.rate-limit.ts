import type { Request } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { logger } from "../../lib/logger";

/**
 * Brake on `POST /platform/signup` (Phase 15.4).
 *
 * Keyed on IP only (Section 10.7). Unlike login, successful requests consume budget — the
 * attack is organization spam, not credential stuffing. Validation failures also count
 * (limiter runs before Zod) so malformed floods cannot bypass the ceiling.
 *
 * Store is the express-rate-limit default: per-process memory. Counters reset on restart and
 * are not shared across API instances. Redis is not used here; login/signup stay in-process
 * (Phase 12 did not migrate auth limiters).
 */
export const signupRateLimiter = rateLimit({
  windowMs: env.SIGNUP_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.SIGNUP_RATE_LIMIT_MAX,
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `signup:${req.ip ?? "unknown-ip"}`,
  handler: (req, _res, next) => {
    logger.warn({ ip: req.ip }, "Signup rate limit exceeded");
    next(
      new AppError(
        429,
        ErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many signup attempts. Try again later.",
      ),
    );
  },
});
