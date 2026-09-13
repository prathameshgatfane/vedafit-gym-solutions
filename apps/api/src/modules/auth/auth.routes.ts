import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { authenticate, authenticateMember, authenticatePlatform } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validation.middleware";
import { authController } from "./auth.controller";
import {
  forgotPasswordRateLimiter,
  loginRateLimiter,
  memberLoginRateLimiter,
  platformLoginRateLimiter,
} from "./auth.rate-limit";
import {
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  memberLoginSchema,
  platformLoginSchema,
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

authRouter.post(
  "/member/login",
  memberLoginRateLimiter,
  validate(memberLoginSchema, "body"),
  asyncHandler(authController.memberLogin),
);
authRouter.post(
  "/member/refresh",
  validate(refreshSchema, "body"),
  asyncHandler(authController.memberRefresh),
);
authRouter.post(
  "/member/logout",
  validate(logoutSchema, "body"),
  asyncHandler(authController.memberLogout),
);
authRouter.get("/member/me", authenticateMember, asyncHandler(authController.memberMe));

authRouter.post(
  "/platform/login",
  platformLoginRateLimiter,
  validate(platformLoginSchema, "body"),
  asyncHandler(authController.platformLogin),
);
authRouter.post(
  "/platform/refresh",
  validate(refreshSchema, "body"),
  asyncHandler(authController.platformRefresh),
);
authRouter.post(
  "/platform/logout",
  validate(logoutSchema, "body"),
  asyncHandler(authController.platformLogout),
);
authRouter.get("/platform/me", authenticatePlatform, asyncHandler(authController.platformMe));
