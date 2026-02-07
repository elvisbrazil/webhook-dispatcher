import { buildApp } from "../../src/app.js";
import { createTenant } from "../../src/modules/tenants/repository.js";
import { createTestDatabase } from "./db.js";

export async function createTestApp() {
  const testDb = await createTestDatabase();
  const app = await buildApp({ db: testDb.db });
  const { tenant, apiKey } = await createTenant(testDb.db, "acme");

  return {
    app,
    db: testDb.db,
    tenant,
    apiKey,
    close: async () => {
      await app.close();
      await testDb.close();
    },
  };
}
