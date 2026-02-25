import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/client.js";
import { deliveries } from "../src/db/schema.js";
import { setEndpointEnabled } from "../src/modules/endpoints/repository.js";
import { publishEvent } from "../src/modules/events/service.js";
import { createTenant } from "../src/modules/tenants/repository.js";
import { MemoryQueue } from "../src/queue/memory.js";
import { createTestDatabase } from "./support/db.js";
import { endpoint } from "./support/fixtures.js";

describe("publishEvent", () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: Database;
  let queue: MemoryQueue;
  let tenantId: string;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    queue = new MemoryQueue();
    tenantId = (await createTenant(db, "acme")).tenant.id;
  });

  afterEach(() => testDb.close());

  const deliveredEndpoints = async (eventId: string) =>
    (await db.select().from(deliveries).where(eq(deliveries.eventId, eventId)))
      .map((d) => d.endpointId)
      .sort();

  it("fans out to every endpoint subscribed to the event type", async () => {
    const orders = await endpoint(db, tenantId, { eventTypes: ["order.created"] });
    const everything = await endpoint(db, tenantId, { eventTypes: ["*"] });
    await endpoint(db, tenantId, { eventTypes: ["invoice.paid"] });

    const result = await publishEvent(db, queue, tenantId, {
      type: "order.created",
      payload: { id: 1 },
    });

    expect(result.deliveries).toBe(2);
    expect(await deliveredEndpoints(result.event.id)).toEqual([orders.id, everything.id].sort());
    expect(queue.jobs).toHaveLength(2);
  });

  it("skips disabled endpoints", async () => {
    const target = await endpoint(db, tenantId);
    await setEndpointEnabled(db, tenantId, target.id, false);

    const result = await publishEvent(db, queue, tenantId, { type: "order.created", payload: {} });

    expect(result.deliveries).toBe(0);
    expect(queue.jobs).toHaveLength(0);
  });

  it("ignores endpoints from other tenants", async () => {
    const other = await createTenant(db, "globex");
    await endpoint(db, other.tenant.id);

    const result = await publishEvent(db, queue, tenantId, { type: "order.created", payload: {} });

    expect(result.deliveries).toBe(0);
  });

  it("returns the original event when the idempotency key is reused", async () => {
    await endpoint(db, tenantId);
    const input = { type: "order.created", payload: { id: 1 }, idempotencyKey: "order-1" };

    const first = await publishEvent(db, queue, tenantId, input);
    const second = await publishEvent(db, queue, tenantId, { ...input, payload: { id: 2 } });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.event.id).toBe(first.event.id);
    expect(second.event.payload).toEqual({ id: 1 });
    expect(second.deliveries).toBe(1);
    expect(queue.jobs).toHaveLength(1);
  });

  it("scopes idempotency keys per tenant", async () => {
    const other = await createTenant(db, "globex");
    const input = { type: "order.created", payload: {}, idempotencyKey: "same" };

    const mine = await publishEvent(db, queue, tenantId, input);
    const theirs = await publishEvent(db, queue, other.tenant.id, input);

    expect(theirs.created).toBe(true);
    expect(theirs.event.id).not.toBe(mine.event.id);
  });
});
