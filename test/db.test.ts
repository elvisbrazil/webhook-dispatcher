import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenants } from "../src/db/schema.js";
import { createTestDatabase } from "./support/db.js";

describe("migrations", () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(() => testDb.close());

  it("creates the schema on a fresh database", async () => {
    const [tenant] = await testDb.db
      .insert(tenants)
      .values({ name: "acme", apiKeyHash: "hash" })
      .returning();
    expect(tenant?.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
