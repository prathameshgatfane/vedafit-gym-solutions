import { Queue } from "bullmq";
import { env } from "../../config/env";
import { createRedis } from "./connection";

export const SEND_QUEUE_NAME = "notifications";
export const SCHEDULER_QUEUE_NAME = "scheduler";

export interface SendJobData {
  logId: string;
}

const queueByName = new Map<string, Queue>();

function getQueue(name: string): Queue {
  const existing = queueByName.get(name);
  if (existing) return existing;
  const queue = new Queue(name, {
    connection: createRedis(),
    prefix: env.QUEUE_PREFIX,
  });
  queueByName.set(name, queue);
  return queue;
}

export function sendQueue(): Queue<SendJobData> {
  return getQueue(SEND_QUEUE_NAME) as Queue<SendJobData>;
}

export function schedulerQueue(): Queue {
  return getQueue(SCHEDULER_QUEUE_NAME);
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queueByName.values()].map((queue) => queue.close()));
  queueByName.clear();
}
