import type { Database } from "../../src/db/client.js";
import { createEndpoint, type NewEndpoint } from "../../src/modules/endpoints/repository.js";

export function endpoint(db: Database, tenantId: string, overrides: Partial<NewEndpoint> = {}) {
  return createEndpoint(db, tenantId, {
    url: "https://hooks.example.com/receive",
    eventTypes: ["order.created"],
    ...overrides,
  });
}
