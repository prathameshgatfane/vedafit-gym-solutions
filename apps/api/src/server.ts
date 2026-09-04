import "dotenv/config";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
