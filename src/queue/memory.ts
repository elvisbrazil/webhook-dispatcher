import type { DeliveryJob, DeliveryQueue, EnqueueOptions } from "./port.js";

export type QueuedJob = DeliveryJob & { delayMs: number };

export class MemoryQueue implements DeliveryQueue {
  jobs: QueuedJob[] = [];

  async enqueue(job: DeliveryJob, options: EnqueueOptions = {}) {
    this.jobs.push({ ...job, delayMs: options.delayMs ?? 0 });
  }

  take() {
    const jobs = this.jobs;
    this.jobs = [];
    return jobs;
  }

  async close() {
    this.jobs = [];
  }
}
