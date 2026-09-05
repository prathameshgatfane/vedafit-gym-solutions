import { z } from "zod";

/**
 * Environment variable contract for the API.
 *
 * Anything without a `.default(...)` is REQUIRED — if it's missing, `loadEnv()` throws
 * immediately at process startup (before the server starts listening), instead of failing
 * later with a confusing "undefined is not a function" style error deep in some handler.
 *
 * Keep this in sync with `.env.example` whenever a var is added/removed.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // Required: every environment must explicitly state which port to bind to.
  PORT: z.coerce.number().int().positive(),
  // Required: which origin(s) the admin-web app is served from, for CORS.
  CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN must not be empty"),
  // Required: MySQL connection string. Also read directly by Prisma via its own env lookup,
  // but we validate it here too so a missing/malformed value fails fast with our error format
  // instead of a raw Prisma connector error deep in the first query.
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL must not be empty")
    .regex(/^mysql:\/\//, "DATABASE_URL must be a mysql:// connection string"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates `process.env` (or a provided source, for testing) against
 * `envSchema`. Throws a single, readable error listing every missing/invalid var at once,
 * rather than one-at-a-time runtime crashes.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    const details = Object.entries(fieldErrors)
      .map(([key, messages]) => `  - ${key}: ${(messages ?? []).join(", ")}`)
      .join("\n");

    throw new Error(
      `Invalid or missing environment variables:\n${details}\n\n` +
        "Check apps/api/.env against apps/api/.env.example and fix the values above.",
    );
  }

  return result.data;
}

export const env = loadEnv();
