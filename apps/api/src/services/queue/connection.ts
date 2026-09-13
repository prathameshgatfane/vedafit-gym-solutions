import Redis from "ioredis";
import { env } from "../../config/env";

/** BullMQ requires `maxRetriesPerRequest: null` on the ioredis connection. */
export function createRedis(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
