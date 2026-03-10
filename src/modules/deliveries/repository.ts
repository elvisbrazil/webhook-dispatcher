import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { deliveries, deliveryAttempts, endpoints, events } from "../../db/schema.js";

export type Delivery = typeof deliveries.$inferSelect;
export type DeliveryAttempt = typeof deliveryAttempts.$inferSelect;
export type DeliveryStatus = Delivery["status"];

export async function findEvent(db: Database, tenantId: string, id: string) {
  const [event] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.id, id)));
  return event;
}

export function listByEvent(db: Database, eventId: string) {
  return db
    .select()
    .from(deliveries)
    .where(eq(deliveries.eventId, eventId))
    .orderBy(asc(deliveries.createdAt));
}

export function listByEndpoint(
  db: Database,
  endpointId: string,
  { status, limit }: { status?: DeliveryStatus | undefined; limit: number },
) {
  return db
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.endpointId, endpointId),
        status ? eq(deliveries.status, status) : undefined,
      ),
    )
    .orderBy(desc(deliveries.createdAt))
    .limit(limit);
}

export function attemptsFor(db: Database, deliveryIds: string[]) {
  if (deliveryIds.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(deliveryAttempts)
    .where(inArray(deliveryAttempts.deliveryId, deliveryIds))
    .orderBy(asc(deliveryAttempts.createdAt));
}

export async function findForTenant(db: Database, tenantId: string, id: string) {
  const [row] = await db
    .select({ delivery: deliveries, endpointEnabled: endpoints.enabled })
    .from(deliveries)
    .innerJoin(endpoints, eq(endpoints.id, deliveries.endpointId))
    .where(and(eq(deliveries.id, id), eq(endpoints.tenantId, tenantId)));
  return row;
}

export async function resetForRetry(db: Database, id: string) {
  const [delivery] = await db
    .update(deliveries)
    .set({
      status: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(deliveries.id, id), eq(deliveries.status, "failed")))
    .returning();
  return delivery;
}
