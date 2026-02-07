import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app.js";

describe("app", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(() => ctx.close());

  it("serves the health check without an api key", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
