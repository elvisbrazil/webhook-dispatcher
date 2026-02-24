import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { DeliveryJob, DeliveryQueue, EnqueueOptions } from "./port.js";

export const QUEUE_NAME = "deliveries";

export function createRedis(url: string) {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export class BullDeliveryQueue implements DeliveryQueue {
  private readonly queue: Queue<DeliveryJob>;

  constructor(connection: Redis) {
    this.queue = new Queue<DeliveryJob>(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }

  async enqueue(job: DeliveryJob, { delayMs = 0 }: EnqueueOptions = {}) {
    await this.queue.add("deliver", job, { delay: delayMs });
  }

  async close() {
    await this.queue.close();
  }
}
