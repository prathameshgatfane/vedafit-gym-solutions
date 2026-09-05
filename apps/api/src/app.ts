import cors from "cors";
import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { errorMiddleware } from "./middleware/error.middleware";
import { organizationRouter } from "./modules/organizations/organization.routes";
import { permissionRouter } from "./modules/permissions/permission.routes";

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

  // Phase 1 feature modules — no auth/tenant middleware yet (that's Phase 2).
  app.use("/api/v1/organizations", organizationRouter);
  app.use("/api/v1/permissions", permissionRouter);

  // 404 for anything else.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  // Centralized error handler (lib/error-codes.ts + middleware/error.middleware.ts) — must be
  // registered last.
  app.use(errorMiddleware);

  return app;
}
