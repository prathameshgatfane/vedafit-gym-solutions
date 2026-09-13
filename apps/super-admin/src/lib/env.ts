import { z } from "zod";

const envSchema = z.object({
  VITE_API_URL: z.string().url("VITE_API_URL must be a valid URL"),
});

export type AppEnv = z.infer<typeof envSchema>;

export function getEnv(source: Record<string, unknown> = import.meta.env): AppEnv {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    const details = Object.entries(fieldErrors)
      .map(([key, messages]) => `  - ${key}: ${(messages ?? []).join(", ")}`)
      .join("\n");

    throw new Error(
      `Invalid or missing environment variables:\n${details}\n\n` +
        "Check apps/super-admin/.env against apps/super-admin/.env.example.",
    );
  }

  return result.data;
}
