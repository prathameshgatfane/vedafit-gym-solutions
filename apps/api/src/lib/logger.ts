import pino from "pino";
import { env } from "../config/env";

/** Paths redacted from access logs and application logs. Never log secrets. */
export const LOGGER_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.set-cookie",
  "res.headers.set-cookie",
  "req.body.password",
  "req.body.owner.password",
  "req.body.currentPassword",
  "req.body.newPassword",
  "password",
  "*.password",
  "*.*.password",
  "passwordHash",
  "*.passwordHash",
  "currentPassword",
  "*.currentPassword",
  "newPassword",
  "*.newPassword",
  "temporaryPassword",
  "*.temporaryPassword",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
] as const;

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [...LOGGER_REDACT_PATHS],
    censor: "[Redacted]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
