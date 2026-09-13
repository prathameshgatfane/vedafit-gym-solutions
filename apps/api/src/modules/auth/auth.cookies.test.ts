import { describe, expect, it } from "vitest";
import type { CookieOptions } from "express";
import {
  PLATFORM_REFRESH_COOKIE_NAME,
  PLATFORM_REFRESH_COOKIE_PATH,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  isRefreshCookieSecure,
  platformRefreshCookieOptions,
  staffRefreshCookieOptions,
} from "./auth.controller";

const expiresAt = new Date("2027-01-01T00:00:00.000Z");

/** Express `res.cookie` emits these flags from CookieOptions — keeps tests off module-level NODE_ENV. */
function setCookieHeader(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) {
    const site = String(options.sameSite);
    parts.push(`SameSite=${site.charAt(0).toUpperCase()}${site.slice(1)}`);
  }
  if (options.path) parts.push(`Path=${options.path}`);
  return parts.join("; ");
}

describe("refresh cookie attributes (Phase 15.13)", () => {
  it("marks staff and platform cookies Secure only when NODE_ENV is production", () => {
    expect(isRefreshCookieSecure("production")).toBe(true);
    expect(isRefreshCookieSecure("development")).toBe(false);
    expect(isRefreshCookieSecure("test")).toBe(false);

    const staffProd = setCookieHeader(
      REFRESH_COOKIE_NAME,
      "token",
      staffRefreshCookieOptions(expiresAt, "production"),
    );
    expect(staffProd).toContain("Secure");
    expect(staffProd).toContain("HttpOnly");
    expect(staffProd).toContain("SameSite=Lax");
    expect(staffProd).toContain(`Path=${REFRESH_COOKIE_PATH}`);

    const staffTest = setCookieHeader(
      REFRESH_COOKIE_NAME,
      "token",
      staffRefreshCookieOptions(expiresAt, "test"),
    );
    expect(staffTest).not.toContain("Secure");

    const platformProd = setCookieHeader(
      PLATFORM_REFRESH_COOKIE_NAME,
      "token",
      platformRefreshCookieOptions(expiresAt, "production"),
    );
    expect(platformProd).toContain("Secure");
    expect(platformProd).toContain("HttpOnly");
    expect(platformProd).toContain("SameSite=Lax");
    expect(platformProd).toContain(`Path=${PLATFORM_REFRESH_COOKIE_PATH}`);

    const platformDev = setCookieHeader(
      PLATFORM_REFRESH_COOKIE_NAME,
      "token",
      platformRefreshCookieOptions(expiresAt, "development"),
    );
    expect(platformDev).not.toContain("Secure");

    expect(REFRESH_COOKIE_NAME).not.toBe(PLATFORM_REFRESH_COOKIE_NAME);
    expect(REFRESH_COOKIE_PATH).not.toBe(PLATFORM_REFRESH_COOKIE_PATH);
  });
});
