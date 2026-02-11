import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTenant } from "../src/modules/tenants/repository.js";
import { createTestApp } from "./support/app.js";

describe("endpoint routes", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(() => ctx.close());

  const register = (apiKey = ctx.apiKey, body: object = {}) =>
    ctx.app.inject({
      method: "POST",
      url: "/endpoints",
      headers: { "x-api-key": apiKey },
      payload: { url: "https://example.com/hooks", eventTypes: ["order.created"], ...body },
    });

  it("rejects requests without an api key", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/endpoints" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("unauthorized");
  });

  it("rejects an unknown api key", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/endpoints",
      headers: { "x-api-key": "whd_nope" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("validates the endpoint body", async () => {
    const res = await register(ctx.apiKey, { url: "ftp://example.com", eventTypes: [] });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("validation_error");
    expect(body.issues.map((i: { path: string }) => i.path)).toEqual(
      expect.arrayContaining(["/url", "/eventTypes"]),
    );
  });

  it("returns the signing secret only when the endpoint is created", async () => {
    const created = await register();
    expect(created.statusCode).toBe(201);
    const endpoint = created.json();
    expect(endpoint.secret).toMatch(/^whsec_/);

    const fetched = await ctx.app.inject({
      method: "GET",
      url: `/endpoints/${endpoint.id}`,
      headers: { "x-api-key": ctx.apiKey },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).not.toHaveProperty("secret");

    const listed = await ctx.app.inject({
      method: "GET",
      url: "/endpoints",
      headers: { "x-api-key": ctx.apiKey },
    });
    expect(listed.json().data).toHaveLength(1);
    expect(listed.json().data[0]).not.toHaveProperty("secret");
  });

  it("does not expose endpoints of other tenants", async () => {
    const endpoint = (await register()).json();
    const other = await createTenant(ctx.db, "globex");

    const res = await ctx.app.inject({
      method: "GET",
      url: `/endpoints/${endpoint.id}`,
      headers: { "x-api-key": other.apiKey },
    });
    expect(res.statusCode).toBe(404);
  });

  it("disables and re-enables an endpoint", async () => {
    const endpoint = (await register()).json();

    const disabled = await ctx.app.inject({
      method: "POST",
      url: `/endpoints/${endpoint.id}/disable`,
      headers: { "x-api-key": ctx.apiKey },
    });
    expect(disabled.json()).toMatchObject({ enabled: false, disabledReason: "disabled manually" });

    const enabled = await ctx.app.inject({
      method: "POST",
      url: `/endpoints/${endpoint.id}/enable`,
      headers: { "x-api-key": ctx.apiKey },
    });
    expect(enabled.json()).toMatchObject({ enabled: true, disabledReason: null });
  });
});
