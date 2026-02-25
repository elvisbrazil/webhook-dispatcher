import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app.js";
import { endpoint } from "./support/fixtures.js";

describe("POST /events", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(() => ctx.close());

  const publish = (payload: object) =>
    ctx.app.inject({
      method: "POST",
      url: "/events",
      headers: { "x-api-key": ctx.apiKey },
      payload,
    });

  it("accepts an event and reports how many deliveries were created", async () => {
    await endpoint(ctx.db, ctx.tenant.id);

    const res = await publish({ type: "order.created", payload: { id: 1 } });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ type: "order.created", deliveries: 1 });
    expect(ctx.queue.jobs).toHaveLength(1);
  });

  it("answers 200 with the same event on an idempotent replay", async () => {
    const body = { type: "order.created", payload: {}, idempotencyKey: "abc" };

    const first = await publish(body);
    const second = await publish(body);

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
  });

  it("rejects a payload that is not an object", async () => {
    const res = await publish({ type: "order.created", payload: "nope" });
    expect(res.statusCode).toBe(400);
  });

  it("requires an api key", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/events",
      payload: { type: "order.created", payload: {} },
    });
    expect(res.statusCode).toBe(401);
  });
});
