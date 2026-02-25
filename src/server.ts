import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { BullDeliveryQueue, createRedis } from "./queue/bullmq.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const queue = new BullDeliveryQueue(redis);

const app = await buildApp({
  db: database.db,
  queue,
  logger: { level: config.LOG_LEVEL },
});

app.addHook("onClose", async () => {
  await queue.close();
  await redis.quit();
  await database.close();
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await app.listen({ host: config.HOST, port: config.PORT });
