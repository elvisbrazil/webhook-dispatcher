import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deliveries, deliveryAttempts } from "../src/db/schema.js";
import { setEndpointEnabled, type Endpoint } from "../src/modules/endpoints/repository.js";
import { createTenant } from "../src/modules/tenants/repository.js";
import { createTestApp } from "./support/app.js";
import { endpoint } from "./support/fixtures.js";

describe("delivery routes", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let target: Endpoint;
  let eventId: string;
  let deliveryId: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    target = await endpoint(ctx.db, ctx.tenant.id);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/events",
      headers: { "x-api-key": ctx.apiKey },
      payload: { type: "order.created", payload: { id: 1 } },
    });
    eventId = res.json().id;
    deliveryId = ctx.queue.take()[0]!.deliveryId;
  });

  afterEach(() => ctx.close());

  const get = (url: string, apiKey = ctx.apiKey) =>
    ctx.app.inject({ method: "GET", url, headers: { "x-api-key": apiKey } });
  const retry = (id = deliveryId) =>
    ctx.app.inject({
      method: "POST",
      url: `/deliveries/${id}/retry`,
      headers: { "x-api-key": ctx.apiKey },
    });

  const failDelivery = async () => {
    await ctx.db
      .update(deliveries)
      .set({ status: "failed", attempts: 1, lastError: "HTTP 500" })
      .where(eq(deliveries.id, deliveryId));
    await ctx.db
      .insert(deliveryAttempts)
      .values({ deliveryId, attempt: 1, statusCode: 500, durationMs: 12 });
  };

  it("lists the deliveries of an event with their attempts", async () => {
    await failDelivery();

    const res = await get(`/events/${eventId}/deliveries`);

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject([
      {
        id: deliveryId,
        endpointId: target.id,
        status: "failed",
        history: [{ attempt: 1, statusCode: 500, error: null, durationMs: 12 }],
      },
    ]);
  });

  it("lists deliveries of an endpoint filtered by status", async () => {
    const pending = await get(`/endpoints/${target.id}/deliveries?status=pending`);
    const failed = await get(`/endpoints/${target.id}/deliveries?status=failed`);

    expect(pending.json().data).toHaveLength(1);
    expect(failed.json().data).toHaveLength(0);
  });

  it("hides deliveries from other tenants", async () => {
    const other = await createTenant(ctx.db, "globex");
    const res = await get(`/events/${eventId}/deliveries`, other.apiKey);
    expect(res.statusCode).toBe(404);
  });

  it("requeues a failed delivery", async () => {
    await failDelivery();

    const res = await retry();

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: "pending", attempts: 0, lastError: null });
    expect(ctx.queue.take()).toEqual([{ deliveryId, delayMs: 0 }]);
  });

  it("refuses to retry a delivery that has not failed", async () => {
    const res = await retry();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("not_retryable");
  });

  it("refuses to retry while the endpoint is disabled", async () => {
    await failDelivery();
    await setEndpointEnabled(ctx.db, ctx.tenant.id, target.id, false);

    const res = await retry();

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("endpoint_disabled");
  });

  it("returns 404 for an unknown delivery", async () => {
    const res = await retry("6b0c2f8e-2a43-4c55-9d3e-1f6f0f3c9a10");
    expect(res.statusCode).toBe(404);
  });
});
