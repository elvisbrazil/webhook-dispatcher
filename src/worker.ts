import { Worker } from "bullmq";
import { pino } from "pino";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { BullDeliveryQueue, createRedis, QUEUE_NAME } from "./queue/bullmq.js";
import type { DeliveryJob } from "./queue/port.js";
import { createDeliverer } from "./webhooks/deliverer.js";

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL, name: "worker" });

const database = createDatabase(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const queue = new BullDeliveryQueue(redis);

const deliverer = createDeliverer({
  db: database.db,
  queue,
  timeoutMs: config.DELIVERY_TIMEOUT_MS,
  disableAfter: config.AUTO_DISABLE_AFTER,
  policy: {
    maxAttempts: config.DELIVERY_MAX_ATTEMPTS,
    baseDelayMs: config.BACKOFF_BASE_MS,
    maxDelayMs: config.BACKOFF_MAX_MS,
  },
});

const worker = new Worker<DeliveryJob>(
  QUEUE_NAME,
  async (job) => {
    const outcome = await deliverer.deliver(job.data.deliveryId);
    log.info({ deliveryId: job.data.deliveryId, ...outcome }, "delivery processed");
  },
  { connection: createRedis(config.REDIS_URL), concurrency: config.WORKER_CONCURRENCY },
);

worker.on("failed", (job, err) => {
  log.error({ err, deliveryId: job?.data.deliveryId }, "delivery job crashed");
});

const shutdown = async (signal: string) => {
  log.info({ signal }, "shutting down");
  await worker.close();
  await queue.close();
  await redis.quit();
  await database.close();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

log.info({ concurrency: config.WORKER_CONCURRENCY }, "worker started");
