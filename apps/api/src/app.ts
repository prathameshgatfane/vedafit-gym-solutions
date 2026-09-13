import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { errorMiddleware } from "./middleware/error.middleware";
import { authRouter } from "./modules/auth/auth.routes";
import { organizationRouter } from "./modules/organizations/organization.routes";
import { permissionRouter } from "./modules/permissions/permission.routes";
import { platformRouter } from "./modules/platform/platform.routes";
import { portalRouter } from "./modules/portal/portal.routes";

/**
 * Builds the Express app. Kept separate from server.ts (which actually binds a port) so
 * this can be imported directly in tests without opening a real network socket.
 */
export function createApp() {
  const app = express();

  // Trust the first proxy hop so `req.ip` is the real client address behind a load balancer —
  // without this every request looks like it comes from the proxy and the login rate limiter
  // would throttle all users as one.
  app.set("trust proxy", 1);

  app.use(helmet());
  const corsOrigins = env.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: corsOrigins.length <= 1 ? (corsOrigins[0] ?? env.CORS_ORIGIN) : corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json());
  // Reads the httpOnly refresh cookie on /auth/refresh and /auth/logout.
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  // Coarse per-IP ceiling for the whole API. The tighter, failed-attempt-aware limiter on
  // /auth/login lives in modules/auth/auth.rate-limit.ts.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: env.GLOBAL_RATE_LIMIT_MAX,
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

  // Auth. The only routes reachable without an access token (except GET /auth/me, which
  // applies `authenticate` itself).
  app.use("/api/v1/auth", authRouter);

  // Public platform signup (15.4) plus per-route authenticatePlatform (15.7/15.8).
  // Must not use tenantScope — URL organizationId is a resource id (10.5).
  app.use("/api/v1/platform", platformRouter);

  // Feature modules. Each router applies `authenticate` + `tenantScope` + `requirePermission`
  // internally rather than relying on a mount-level guard here, so a route can't be added later
  // that silently skips them.
  app.use("/api/v1/organizations", organizationRouter);
  app.use("/api/v1/permissions", permissionRouter);
  app.use("/api/v1/me", portalRouter);

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
