export type DeliveryJob = {
  deliveryId: string;
};

export type EnqueueOptions = {
  delayMs?: number;
};

export interface DeliveryQueue {
  enqueue(job: DeliveryJob, options?: EnqueueOptions): Promise<void>;
  close(): Promise<void>;
}
