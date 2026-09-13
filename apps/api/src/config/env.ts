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
  // Required: comma-separated browser origins (admin-web, super-admin, Flutter Web).
  // Credentialed CORS cannot use `*` (1.23.5). localhost and 127.0.0.1 are distinct.
  CORS_ORIGIN: z
    .string()
    .min(1, "CORS_ORIGIN must not be empty")
    .refine(
      (value) =>
        !value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
          .some((origin) => origin === "*"),
      "CORS_ORIGIN cannot include * while credentialed requests are enabled",
    ),
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

  // ── Auth (Phase 2) ──────────────────────────────────────────────────────────
  // Required, and deliberately long: a weak signing key silently undermines every other
  // auth control in the system, so refuse to boot rather than warn.
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters"),
  // Access tokens are short-lived by design (Section 7, Phase 2) — the refresh cookie is what
  // keeps a session alive, so this should stay in minutes, not hours.
  JWT_ACCESS_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  // Domain the refresh cookie is scoped to. Left as the request host when unset.
  COOKIE_DOMAIN: z.string().optional(),
  // Number of failed logins (per IP + email) before the login endpoint starts returning 429.
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  // Public gym signup (Phase 15.4). Per-IP, including successful creates — org-spam brake.
  SIGNUP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  SIGNUP_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  // Public signup trial length (Phase 15.5). Catalog `trialDays` is metadata; this drives period end.
  SAAS_TRIAL_DAYS: z.coerce.number().int().positive().default(14),
  // Coarse per-IP ceiling across the whole API. Raised in the test env, where the entire suite
  // hits the server from one address.
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  // ── Notifications / queue (Phase 12) ────────────────────────────────────────
  // Redis is required the same way MySQL is: the nightly job and the send worker
  // are not optional adapters. Default matches docker-compose and the no-Docker sandbox.
  REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),
  // BullMQ key prefix so a test run cannot consume a dev queue (1.22.3).
  QUEUE_PREFIX: z.string().min(1).default("gym"),
  NOTIFICATION_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  NOTIFICATION_BACKOFF_MS: z.coerce.number().int().min(1).default(10_000),
  NIGHTLY_LOCAL_HOUR: z.coerce.number().int().min(0).max(23).default(21),
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
