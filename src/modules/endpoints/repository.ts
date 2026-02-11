import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { endpoints } from "../../db/schema.js";

export type Endpoint = typeof endpoints.$inferSelect;

export type NewEndpoint = {
  url: string;
  description?: string | undefined;
  eventTypes: string[];
};

export function generateSecret() {
  return `whsec_${randomBytes(24).toString("base64")}`;
}

export async function createEndpoint(db: Database, tenantId: string, input: NewEndpoint) {
  const [endpoint] = await db
    .insert(endpoints)
    .values({
      tenantId,
      url: input.url,
      description: input.description,
      eventTypes: input.eventTypes,
      secret: generateSecret(),
    })
    .returning();
  return endpoint!;
}

export function listEndpoints(db: Database, tenantId: string) {
  return db
    .select()
    .from(endpoints)
    .where(eq(endpoints.tenantId, tenantId))
    .orderBy(desc(endpoints.createdAt));
}

export async function findEndpoint(db: Database, tenantId: string, id: string) {
  const [endpoint] = await db
    .select()
    .from(endpoints)
    .where(and(eq(endpoints.tenantId, tenantId), eq(endpoints.id, id)));
  return endpoint;
}

export async function setEndpointEnabled(
  db: Database,
  tenantId: string,
  id: string,
  enabled: boolean,
) {
  const [endpoint] = await db
    .update(endpoints)
    .set({
      enabled,
      disabledReason: enabled ? null : "disabled manually",
      consecutiveFailures: 0,
    })
    .where(and(eq(endpoints.tenantId, tenantId), eq(endpoints.id, id)))
    .returning();
  return endpoint;
}
