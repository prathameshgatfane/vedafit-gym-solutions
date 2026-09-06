import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { authenticate } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validation.middleware";
import { authController } from "./auth.controller";
import { forgotPasswordRateLimiter, loginRateLimiter } from "./auth.rate-limit";
import {
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  resetPasswordSchema,
} from "./auth.schema";

export const authRouter = Router();

// Public. The rate limiter runs before validation so malformed spam is counted too.
authRouter.post(
  "/login",
  loginRateLimiter,
  validate(loginSchema, "body"),
  asyncHandler(authController.login),
);

// Public in the sense that no access token is required — the refresh cookie *is* the credential.
authRouter.post(
  "/refresh",
  validate(refreshSchema, "body"),
  asyncHandler(authController.refresh),
);

authRouter.post(
  "/logout",
  validate(logoutSchema, "body"),
  asyncHandler(authController.logout),
);

authRouter.post(
  "/forgot-password",
  forgotPasswordRateLimiter,
  validate(forgotPasswordSchema, "body"),
  asyncHandler(authController.forgotPassword),
);

authRouter.post(
  "/reset-password",
  validate(resetPasswordSchema, "body"),
  asyncHandler(authController.resetPassword),
);

// Authenticated. No tenantScope: /me has no client-supplied org or branch to reject — the whole
// response is derived from the token.
authRouter.get("/me", authenticate, asyncHandler(authController.me));
