import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";

/**
 * Builds the Express app. Kept separate from server.ts (which actually binds a port) so
 * this can be imported directly in tests without opening a real network socket.
 */
export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  // Basic global rate limit. Per-route limits (e.g. tighter on /auth/login) land in Phase 2.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // Health check — infra-level, not a feature module. No auth/tenant middleware applies here.
  app.get("/api/v1/health", (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      data: { status: "ok", uptimeSeconds: process.uptime() },
      message: "API is healthy",
    });
  });

  // 404 for anything else — real feature routes are mounted starting Phase 1.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  // Minimal fallback error handler. A dedicated error.middleware.ts with the full
  // ErrorCode registry lands in Phase 1.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "Unhandled error");
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
    });
  });

  return app;
}
