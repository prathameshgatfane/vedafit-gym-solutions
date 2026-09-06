import type { Request } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { logger } from "../../lib/logger";

/**
 * Brake on credential stuffing against `POST /auth/login`.
 *
 * Keyed on IP **and** submitted email rather than IP alone: one office NATs all its staff behind
 * a single address, so an IP-only counter would lock out a whole gym because one person fat-fingered
 * their password. Pairing the two still stops both shapes of attack that matter — many passwords
 * against one account, and one password against many accounts from one source.
 *
 * `skipSuccessfulRequests` means only *failed* logins consume budget, so an active admin is never
 * throttled for working normally.
 *
 * Known limit: the default store is per-process memory, so the counter resets on restart and is
 * not shared across instances. A Redis-backed store replaces it in Phase 12, when Redis is
 * introduced for a feature that actually needs it (Section 8: don't build Redis before then).
 */
export const loginRateLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    const emailKey = typeof email === "string" ? email.trim().toLowerCase() : "<none>";
    return `login:${req.ip ?? "unknown-ip"}:${emailKey}`;
  },
  handler: (req, _res, next) => {
    logger.warn({ ip: req.ip }, "Login rate limit exceeded");
    next(
      new AppError(
        429,
        ErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many failed login attempts. Try again later.",
      ),
    );
  },
});

/**
 * Same idea for the reset-request endpoint, which is otherwise a free way to spam someone's inbox
 * (and, once Phase 12 wires real email, to burn send quota).
 */
export const forgotPasswordRateLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    const emailKey = typeof email === "string" ? email.trim().toLowerCase() : "<none>";
    return `forgot:${req.ip ?? "unknown-ip"}:${emailKey}`;
  },
  handler: (_req, _res, next) => {
    next(
      new AppError(
        429,
        ErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many password reset requests. Try again later.",
      ),
    );
  },
});
