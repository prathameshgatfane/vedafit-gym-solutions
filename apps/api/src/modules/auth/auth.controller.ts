import type { CookieOptions, Request, Response } from "express";
import { env, type Env } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { getAuth, getMemberAuth, getPlatformAuth } from "../../middleware/auth.middleware";
import { authService, type IssuedSession } from "./auth.service";
import { memberAuthService } from "./member-auth.service";
import { platformAuthService, type IssuedPlatformSession } from "./platform-auth.service";
import type {
  ForgotPasswordInput,
  LoginInput,
  MemberLoginInput,
  PlatformLoginInput,
  RefreshInput,
  ResetPasswordInput,
} from "./auth.schema";

export const REFRESH_COOKIE_NAME = "refresh_token";
export const PLATFORM_REFRESH_COOKIE_NAME = "platform_refresh";

/**
 * Scoped to the auth routes so it is never attached to ordinary API calls — the smaller the
 * cookie's blast radius, the less it matters if some other endpoint ever reflects headers.
 */
export const REFRESH_COOKIE_PATH = "/api/v1/auth";
export const PLATFORM_REFRESH_COOKIE_PATH = "/api/v1/auth/platform";

/** Secure only in production — a Secure cookie is dropped on plain http localhost. */
export function isRefreshCookieSecure(nodeEnv: Env["NODE_ENV"] = env.NODE_ENV): boolean {
  return nodeEnv === "production";
}

export function staffRefreshCookieOptions(
  expiresAt: Date,
  nodeEnv: Env["NODE_ENV"] = env.NODE_ENV,
): CookieOptions {
  return {
    httpOnly: true,
    secure: isRefreshCookieSecure(nodeEnv),
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    domain: env.COOKIE_DOMAIN,
    expires: expiresAt,
  };
}

export function platformRefreshCookieOptions(
  expiresAt: Date,
  nodeEnv: Env["NODE_ENV"] = env.NODE_ENV,
): CookieOptions {
  return {
    httpOnly: true,
    secure: isRefreshCookieSecure(nodeEnv),
    sameSite: "lax",
    path: PLATFORM_REFRESH_COOKIE_PATH,
    domain: env.COOKIE_DOMAIN,
    expires: expiresAt,
  };
}

function setRefreshCookie(res: Response, session: IssuedSession): void {
  res.cookie(
    REFRESH_COOKIE_NAME,
    session.refreshToken,
    staffRefreshCookieOptions(session.refreshTokenExpiresAt),
  );
}

function setPlatformRefreshCookie(res: Response, session: IssuedPlatformSession): void {
  res.cookie(
    PLATFORM_REFRESH_COOKIE_NAME,
    session.refreshToken,
    platformRefreshCookieOptions(session.refreshTokenExpiresAt),
  );
}

function clearPlatformRefreshCookie(res: Response): void {
  res.clearCookie(PLATFORM_REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isRefreshCookieSecure(),
    sameSite: "lax",
    path: PLATFORM_REFRESH_COOKIE_PATH,
    domain: env.COOKIE_DOMAIN,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isRefreshCookieSecure(),
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

function readPlatformRefreshToken(req: Request): string | undefined {
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[
    PLATFORM_REFRESH_COOKIE_NAME
  ];
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

  async memberLogin(req: Request, res: Response): Promise<void> {
    const result = await memberAuthService.login(req.body as MemberLoginInput);
    res.status(200).json({
      success: true,
      data: {
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken,
        tokenType: "Bearer",
        expiresIn: result.session.expiresIn,
        member: result.member,
        organization: result.organization,
        branch: result.branch,
      },
      message: "Logged in",
    });
  },

  async memberRefresh(req: Request, res: Response): Promise<void> {
    const rawToken = (req.body as RefreshInput | undefined)?.refreshToken;
    if (!rawToken) {
      throw new AppError(401, ErrorCode.INVALID_TOKEN, "No refresh token was provided");
    }
    const result = await memberAuthService.refresh(rawToken);
    res.status(200).json({
      success: true,
      data: {
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken,
        tokenType: "Bearer",
        expiresIn: result.session.expiresIn,
      },
      message: "Token refreshed",
    });
  },

  async memberLogout(req: Request, res: Response): Promise<void> {
    await memberAuthService.logout((req.body as RefreshInput | undefined)?.refreshToken);
    res.status(200).json({ success: true, data: null, message: "Logged out" });
  },

  async memberMe(req: Request, res: Response): Promise<void> {
    const data = await memberAuthService.me(getMemberAuth(req));
    res.status(200).json({ success: true, data, message: "Current session" });
  },

  async platformLogin(req: Request, res: Response): Promise<void> {
    const { session, user } = await platformAuthService.login(req.body as PlatformLoginInput);
    setPlatformRefreshCookie(res, session);
    res.status(200).json({
      success: true,
      data: {
        accessToken: session.accessToken,
        tokenType: "Bearer",
        expiresIn: session.expiresIn,
        user,
      },
      message: "Logged in",
    });
  },

  async platformRefresh(req: Request, res: Response): Promise<void> {
    const rawToken = readPlatformRefreshToken(req);
    if (!rawToken) {
      throw new AppError(401, ErrorCode.INVALID_TOKEN, "No refresh token was provided");
    }

    let result;
    try {
      result = await platformAuthService.refresh(rawToken);
    } catch (err) {
      clearPlatformRefreshCookie(res);
      throw err;
    }

    setPlatformRefreshCookie(res, result.session);
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

  async platformLogout(req: Request, res: Response): Promise<void> {
    await platformAuthService.logout(readPlatformRefreshToken(req));
    clearPlatformRefreshCookie(res);
    res.status(200).json({ success: true, data: null, message: "Logged out" });
  },

  async platformMe(req: Request, res: Response): Promise<void> {
    const data = await platformAuthService.me(getPlatformAuth(req));
    res.status(200).json({ success: true, data, message: "Current session" });
  },
};
