import { z } from "zod";

/**
 * Mirrors the API's `loginSchema` (apps/api/src/modules/auth/auth.schema.ts) so obvious mistakes
 * are caught before a network round-trip. The server revalidates regardless — this is a UX
 * affordance, never the security boundary.
 */
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;
