import { eq } from "drizzle-orm";
import { MockAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/client.js";
import { deliveries, deliveryAttempts } from "../src/db/schema.js";
import type { Endpoint } from "../src/modules/endpoints/repository.js";
import { publishEvent } from "../src/modules/events/service.js";
import { createTenant } from "../src/modules/tenants/repository.js";
import { MemoryQueue } from "../src/queue/memory.js";
import { createDeliverer } from "../src/webhooks/deliverer.js";
import { verify } from "../src/webhooks/signature.js";
import { createTestDatabase } from "./support/db.js";
import { endpoint } from "./support/fixtures.js";

const ORIGIN = "https://hooks.example.com";
const policy = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60_000 };

describe("deliverer", () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: Database;
  let queue: MemoryQueue;
  let agent: MockAgent;
  let target: Endpoint;
  let deliverer: ReturnType<typeof createDeliverer>;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    queue = new MemoryQueue();
    agent = new MockAgent();
    agent.disableNetConnect();

    const { tenant } = await createTenant(db, "acme");
    target = await endpoint(db, tenant.id, { url: `${ORIGIN}/receive` });
    await publishEvent(db, queue, tenant.id, { type: "order.created", payload: { id: 7 } });

    deliverer = createDeliverer({
      db,
      queue,
      policy,
      timeoutMs: 100,
      dispatcher: agent,
      random: () => 1,
    });
  });

  afterEach(async () => {
    await agent.close();
    await testDb.close();
  });

  const pool = () => agent.get(ORIGIN);
  const intercept = () => pool().intercept({ path: "/receive", method: "POST" });
  const nextJob = () => queue.take()[0]!;
  const loadDelivery = async (id: string) =>
    (await db.select().from(deliveries).where(eq(deliveries.id, id)))[0]!;
  const loadAttempts = (id: string) =>
    db.select().from(deliveryAttempts).where(eq(deliveryAttempts.deliveryId, id));

  it("posts a signed payload and marks the delivery as succeeded", async () => {
    let received: { body: string; headers: Record<string, string> } | undefined;
    intercept().reply((options) => {
      received = {
        body: String(options.body),
        headers: options.headers as Record<string, string>,
      };
      return { statusCode: 200, data: "ok" };
    });
    const job = nextJob();

    const outcome = await deliverer.deliver(job.deliveryId);

    expect(outcome).toEqual({ action: "succeed" });
    expect(JSON.parse(received!.body)).toMatchObject({ type: "order.created", data: { id: 7 } });
    expect(received!.headers["content-type"]).toBe("application/json");
    expect(verify(target.secret, received!.body, received!.headers)).toBe(true);

    const delivery = await loadDelivery(job.deliveryId);
    expect(delivery).toMatchObject({ status: "succeeded", attempts: 1, lastError: null });
    expect(await loadAttempts(job.deliveryId)).toMatchObject([{ attempt: 1, statusCode: 200 }]);
    expect(queue.jobs).toHaveLength(0);
  });

  it("retries a 500 and succeeds on the next attempt", async () => {
    intercept().reply(500, "boom");
    intercept().reply(204, "");
    const job = nextJob();

    const first = await deliverer.deliver(job.deliveryId);
    expect(first).toEqual({ action: "retry", delayMs: 1000, reason: "HTTP 500" });
    expect(await loadDelivery(job.deliveryId)).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "HTTP 500",
    });

    const retry = nextJob();
    expect(retry).toEqual({ deliveryId: job.deliveryId, delayMs: 1000 });

    const second = await deliverer.deliver(retry.deliveryId);
    expect(second).toEqual({ action: "succeed" });
    expect(await loadDelivery(job.deliveryId)).toMatchObject({ status: "succeeded", attempts: 2 });

    const attempts = await loadAttempts(job.deliveryId);
    expect(attempts.map((a) => a.statusCode).sort()).toEqual([204, 500]);
  });

  it("treats a slow endpoint as a timeout and schedules a retry", async () => {
    intercept().reply(200, "late").delay(500);
    const job = nextJob();

    const outcome = await deliverer.deliver(job.deliveryId);

    expect(outcome).toEqual({
      action: "retry",
      delayMs: 1000,
      reason: "timeout after 100ms",
    });
    expect(await loadAttempts(job.deliveryId)).toMatchObject([
      { statusCode: null, error: "timeout after 100ms" },
    ]);
  });

  it("fails permanently on a 4xx without retrying", async () => {
    intercept().reply(410, "gone");
    const job = nextJob();

    const outcome = await deliverer.deliver(job.deliveryId);

    expect(outcome).toEqual({ action: "fail", reason: "HTTP 410" });
    expect(await loadDelivery(job.deliveryId)).toMatchObject({ status: "failed" });
    expect(queue.jobs).toHaveLength(0);
  });

  it("marks the delivery as failed after the last attempt", async () => {
    intercept().reply(503, "").times(3);
    const job = nextJob();

    await deliverer.deliver(job.deliveryId);
    await deliverer.deliver(nextJob().deliveryId);
    const last = await deliverer.deliver(nextJob().deliveryId);

    expect(last).toEqual({ action: "fail", reason: "HTTP 503 after 3 attempts" });
    expect(await loadDelivery(job.deliveryId)).toMatchObject({ status: "failed", attempts: 3 });
    expect(queue.jobs).toHaveLength(0);
  });

  it("skips deliveries that are no longer pending", async () => {
    intercept().reply(200, "ok");
    const job = nextJob();
    await deliverer.deliver(job.deliveryId);

    expect(await deliverer.deliver(job.deliveryId)).toEqual({ action: "skipped" });
  });
});
