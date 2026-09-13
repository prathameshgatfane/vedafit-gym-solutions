import "dotenv/config";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { startWorkers } from "./services/queue/worker";

const app = createApp();

app.listen(env.PORT, "0.0.0.0", () => {
  logger.info(
    `API listening on http://0.0.0.0:${env.PORT} (${env.NODE_ENV}) — reachable on the LAN, not just loopback`,
  );
});

if (env.NODE_ENV !== "test") {
  startWorkers().catch((error) => {
    logger.error({ err: error }, "notification workers failed to start");
  });
}
