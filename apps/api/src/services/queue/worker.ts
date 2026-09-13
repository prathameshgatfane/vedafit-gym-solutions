import { Worker, type Job } from "bullmq";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { createRedis } from "./connection";
import {
  SCHEDULER_QUEUE_NAME,
  SEND_QUEUE_NAME,
  schedulerQueue,
  type SendJobData,
} from "./queues";
import { runNightlyTick } from "../notification/scan";
import { logOnlySender, type NotificationSender } from "../notification/sender";

export interface StartedWorkers {
  send: Worker<SendJobData>;
  scheduler: Worker;
  stop: () => Promise<void>;
}

async function processSend(
  job: Job<SendJobData>,
  sender: NotificationSender,
): Promise<void> {
  const log = await prisma.notificationLog.findUnique({ where: { id: job.data.logId } });
  if (!log) return;
  if (log.status === "SENT") return;

  await sender({
    logId: log.id,
    event: log.event,
    channel: log.channel,
    body: log.body,
    memberId: log.memberId,
  });

  await prisma.notificationLog.update({
    where: { id: log.id },
    data: { status: "SENT", sentAt: new Date(), lastError: null },
  });
}

async function markFailed(logId: string, message: string): Promise<void> {
  await prisma.notificationLog.updateMany({
    where: { id: logId, status: "QUEUED" },
    data: { status: "FAILED", lastError: message.slice(0, 500) },
  });
}

export async function startWorkers(options?: {
  sender?: NotificationSender;
}): Promise<StartedWorkers> {
  const sender = options?.sender ?? logOnlySender;
  const sendConnection = createRedis();
  const schedulerConnection = createRedis();

  const send = new Worker<SendJobData>(
    SEND_QUEUE_NAME,
    (job) => processSend(job, sender),
    { connection: sendConnection, prefix: env.QUEUE_PREFIX, concurrency: 5 },
  );

  send.on("failed", (job, error) => {
    const attempts = job?.opts.attempts ?? env.NOTIFICATION_ATTEMPTS;
    const made = job?.attemptsMade ?? 0;
    logger.warn({ logId: job?.data.logId, made, attempts, err: error.message }, "notification.send failed");
    if (job && made >= attempts) {
      void markFailed(job.data.logId, error.message);
    }
  });

  const scheduler = new Worker(
    SCHEDULER_QUEUE_NAME,
    async () => runNightlyTick(new Date()),
    { connection: schedulerConnection, prefix: env.QUEUE_PREFIX },
  );

  // upsert, not add: a `tsx watch` restart must not throw "job already exists".
  await schedulerQueue().upsertJobScheduler(
    "nightly-tick",
    { every: 15 * 60 * 1000 },
    { name: "tick", data: {} },
  );

  logger.info({ prefix: env.QUEUE_PREFIX }, "notification workers started");

  return {
    send,
    scheduler,
    stop: async () => {
      await Promise.all([send.close(), scheduler.close()]);
      await Promise.all([sendConnection.quit(), schedulerConnection.quit()]);
    },
  };
}

/** Test helper: send worker only, no 15-minute scheduler. */
export async function startSendWorker(options?: {
  sender?: NotificationSender;
}): Promise<{ worker: Worker<SendJobData>; stop: () => Promise<void> }> {
  const sender = options?.sender ?? logOnlySender;
  const connection = createRedis();
  const worker = new Worker<SendJobData>(
    SEND_QUEUE_NAME,
    (job) => processSend(job, sender),
    { connection, prefix: env.QUEUE_PREFIX, concurrency: 5 },
  );
  worker.on("failed", (job, error) => {
    const attempts = job?.opts.attempts ?? env.NOTIFICATION_ATTEMPTS;
    const made = job?.attemptsMade ?? 0;
    if (job && made >= attempts) {
      void markFailed(job.data.logId, error.message);
    }
  });
  return {
    worker,
    stop: async () => {
      await worker.close();
      await connection.quit();
    },
  };
}

export async function waitForLogTerminal(logId: string, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const log = await prisma.notificationLog.findUnique({ where: { id: logId } });
    if (log && (log.status === "SENT" || log.status === "FAILED")) return log;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Notification log ${logId} did not reach SENT or FAILED within ${timeoutMs}ms`);
}
