import { z } from "zod";

/**
 * Environment variable contract for the admin-web app.
 *
 * Vite only exposes vars prefixed with `VITE_` to client code (via `import.meta.env`), and
 * inlines them at build time. Anything without a `.default(...)` below is REQUIRED — if
 * missing, `getEnv()` throws immediately when the app boots, instead of failing later with a
 * confusing network error when some API call silently hits `undefined`.
 *
 * Keep this in sync with `.env.example` whenever a var is added/removed.
 */
const envSchema = z.object({
  // Required: base URL of the API this app talks to.
  VITE_API_URL: z.string().url("VITE_API_URL must be a valid URL"),
});

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Parses and validates `import.meta.env` (or a provided source, for testing) against
 * `envSchema`. Throws a single, readable error listing every missing/invalid var at once.
 */
export function getEnv(source: Record<string, unknown> = import.meta.env): AppEnv {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    const details = Object.entries(fieldErrors)
      .map(([key, messages]) => `  - ${key}: ${(messages ?? []).join(", ")}`)
      .join("\n");

    throw new Error(
      `Invalid or missing environment variables:\n${details}\n\n` +
        "Check apps/admin-web/.env against apps/admin-web/.env.example and fix the values above.",
    );
  }

  return result.data;
}
