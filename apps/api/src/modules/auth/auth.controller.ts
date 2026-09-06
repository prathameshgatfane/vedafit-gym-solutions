import type { CookieOptions, Request, Response } from "express";
import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { getAuth } from "../../middleware/auth.middleware";
import { authService, type IssuedSession } from "./auth.service";
import type {
  ForgotPasswordInput,
  LoginInput,
  RefreshInput,
  ResetPasswordInput,
} from "./auth.schema";

export const REFRESH_COOKIE_NAME = "refresh_token";

/**
 * Scoped to the auth routes so it is never attached to ordinary API calls — the smaller the
 * cookie's blast radius, the less it matters if some other endpoint ever reflects headers.
 */
const REFRESH_COOKIE_PATH = "/api/v1/auth";

function refreshCookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true, // JS in the browser must never be able to read this
    secure: env.NODE_ENV === "production", // plain http on localhost would drop a Secure cookie
    sameSite: "lax", // admin-web is same-site with the API; blocks cross-site CSRF replay
    path: REFRESH_COOKIE_PATH,
    domain: env.COOKIE_DOMAIN,
    expires: expiresAt,
  };
}

function setRefreshCookie(res: Response, session: IssuedSession): void {
  res.cookie(
    REFRESH_COOKIE_NAME,
    session.refreshToken,
    refreshCookieOptions(session.refreshTokenExpiresAt),
  );
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    domain: env.COOKIE_DOMAIN,
  });
}

/** Cookie first, body second — a browser session should never be overridable by a body field. */
function readRefreshToken(req: Request): string | undefined {
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
  if (fromCookie) return fromCookie;
  return (req.body as RefreshInput | undefined)?.refreshToken;
}

export const authController = {
  async login(req: Request, res: Response): Promise<void> {
    const { session, user } = await authService.login(req.body as LoginInput);
    setRefreshCookie(res, session);

    res.status(200).json({
      success: true,
      data: {
        accessToken: session.accessToken,
        tokenType: "Bearer",
        expiresIn: session.expiresIn,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          organizationId: user.organizationId,
          branchId: user.branchId,
          roleId: user.roleId,
        },
      },
      message: "Logged in",
    });
  },

  async refresh(req: Request, res: Response): Promise<void> {
    const rawToken = readRefreshToken(req);
    if (!rawToken) {
      throw new AppError(401, ErrorCode.INVALID_TOKEN, "No refresh token was provided");
    }

    let result;
    try {
      result = await authService.refresh(rawToken);
    } catch (err) {
      // The token is dead either way — don't leave the browser holding it.
      clearRefreshCookie(res);
      throw err;
    }

    setRefreshCookie(res, result.session);
    res.status(200).json({
      success: true,
      data: {
        accessToken: result.session.accessToken,
        tokenType: "Bearer",
        expiresIn: result.session.expiresIn,
      },
      message: "Token refreshed",
    });
  },

  async logout(req: Request, res: Response): Promise<void> {
    await authService.logout(readRefreshToken(req));
    clearRefreshCookie(res);
    res.status(200).json({ success: true, data: null, message: "Logged out" });
  },

  async me(req: Request, res: Response): Promise<void> {
    const data = await authService.me(getAuth(req));
    res.status(200).json({ success: true, data, message: "Current session" });
  },

  async forgotPassword(req: Request, res: Response): Promise<void> {
    const { resetToken } = await authService.forgotPassword(req.body as ForgotPasswordInput);

    // Outside production the token is returned so the flow is testable without a mail transport.
    // Explicit allowlist rather than `!== "production"` so an unset NODE_ENV can't leak it.
    const exposeToken = env.NODE_ENV === "development" || env.NODE_ENV === "test";

    res.status(200).json({
      success: true,
      data: exposeToken && resetToken ? { resetToken } : null,
      message: "If that email is registered, a password reset link has been sent",
    });
  },

  async resetPassword(req: Request, res: Response): Promise<void> {
    await authService.resetPassword(req.body as ResetPasswordInput);
    clearRefreshCookie(res);
    res.status(200).json({
      success: true,
      data: null,
      message: "Password updated — please log in again",
    });
  },
};
