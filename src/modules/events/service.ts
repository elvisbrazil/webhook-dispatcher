import { and, count, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { deliveries, endpoints, events } from "../../db/schema.js";
import type { DeliveryQueue } from "../../queue/port.js";

export type PublishInput = {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string | undefined;
};

export type PublishResult = {
  event: typeof events.$inferSelect;
  deliveries: number;
  created: boolean;
};

async function existingEvent(db: Database, tenantId: string, idempotencyKey: string) {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.idempotencyKey, idempotencyKey)));
  if (!event) return undefined;

  const [row] = await db
    .select({ total: count() })
    .from(deliveries)
    .where(eq(deliveries.eventId, event.id));
  return { event, deliveries: row?.total ?? 0, created: false };
}

export async function publishEvent(
  db: Database,
  queue: DeliveryQueue,
  tenantId: string,
  input: PublishInput,
): Promise<PublishResult> {
  if (input.idempotencyKey) {
    const existing = await existingEvent(db, tenantId, input.idempotencyKey);
    if (existing) return existing;
  }

  const result = await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(events)
      .values({
        tenantId,
        type: input.type,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing({ target: [events.tenantId, events.idempotencyKey] })
      .returning();
    if (!event) return undefined;

    const targets = await tx
      .select({ id: endpoints.id })
      .from(endpoints)
      .where(
        and(
          eq(endpoints.tenantId, tenantId),
          eq(endpoints.enabled, true),
          sql`(${input.type} = any(${endpoints.eventTypes}) or '*' = any(${endpoints.eventTypes}))`,
        ),
      );

    const created = targets.length
      ? await tx
          .insert(deliveries)
          .values(targets.map((target) => ({ eventId: event.id, endpointId: target.id })))
          .returning({ id: deliveries.id })
      : [];

    return { event, deliveryIds: created.map((d) => d.id) };
  });

  if (!result) {
    const existing = await existingEvent(db, tenantId, input.idempotencyKey!);
    return existing!;
  }

  for (const deliveryId of result.deliveryIds) {
    await queue.enqueue({ deliveryId });
  }

  return { event: result.event, deliveries: result.deliveryIds.length, created: true };
}
