import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
  /**
   * Only needed when the same email exists in more than one organization — the API asks for it
   * with AMBIGUOUS_LOGIN rather than requiring it up front, so the common single-org case stays
   * a plain email + password form.
   */
  organizationSlug: z.string().trim().min(1).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const platformLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;

export const memberLoginSchema = z.object({
  phone: z.string().trim().min(8, "Phone is required"),
  password: z.string().min(1, "Password is required"),
  organizationSlug: z.string().trim().min(1, "Organization is required"),
});
export type MemberLoginInput = z.infer<typeof memberLoginSchema>;

/**
 * The refresh token normally arrives in the httpOnly cookie. The body field exists for
 * non-browser clients (the Flutter app in Phase 13, scripts, tests) that have nowhere to put a
 * cookie; the cookie takes precedence when both are present.
 */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = refreshSchema;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[0-9]/, "Password must contain a number"),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
