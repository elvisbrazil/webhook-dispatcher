import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { HttpError, notFound } from "../../errors.js";
import type { DeliveryQueue } from "../../queue/port.js";
import { findEndpoint } from "../endpoints/repository.js";
import {
  attemptsFor,
  findEvent,
  findForTenant,
  listByEndpoint,
  listByEvent,
  resetForRetry,
  type Delivery,
  type DeliveryAttempt,
} from "./repository.js";

const attemptResponse = z.object({
  attempt: z.number().int(),
  statusCode: z.number().int().nullable(),
  error: z.string().nullable(),
  durationMs: z.number().int(),
  createdAt: z.string(),
});

const deliveryResponse = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  endpointId: z.uuid(),
  status: z.enum(["pending", "succeeded", "failed"]),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  history: z.array(attemptResponse),
});

const listResponse = z.object({ data: z.array(deliveryResponse) });
const idParams = z.object({ id: z.uuid() });

function toResponse(delivery: Delivery, attempts: DeliveryAttempt[]) {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    endpointId: delivery.endpointId,
    status: delivery.status,
    attempts: delivery.attempts,
    lastError: delivery.lastError,
    nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
    history: attempts
      .filter((a) => a.deliveryId === delivery.id)
      .map((a) => ({
        attempt: a.attempt,
        statusCode: a.statusCode,
        error: a.error,
        durationMs: a.durationMs,
        createdAt: a.createdAt.toISOString(),
      })),
  };
}

export const deliveryRoutes: FastifyPluginAsyncZod<{ db: Database; queue: DeliveryQueue }> = async (
  app,
  { db, queue },
) => {
  const withHistory = async (rows: Delivery[]) => {
    const attempts = await attemptsFor(
      db,
      rows.map((d) => d.id),
    );
    return { data: rows.map((d) => toResponse(d, attempts)) };
  };

  app.get(
    "/events/:id/deliveries",
    { schema: { params: idParams, response: { 200: listResponse } } },
    async (request) => {
      const event = await findEvent(db, request.tenantId, request.params.id);
      if (!event) throw notFound("event");
      return withHistory(await listByEvent(db, event.id));
    },
  );

  app.get(
    "/endpoints/:id/deliveries",
    {
      schema: {
        params: idParams,
        querystring: z.object({
          status: z.enum(["pending", "succeeded", "failed"]).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: { 200: listResponse },
      },
    },
    async (request) => {
      const endpoint = await findEndpoint(db, request.tenantId, request.params.id);
      if (!endpoint) throw notFound("endpoint");
      return withHistory(await listByEndpoint(db, endpoint.id, request.query));
    },
  );

  app.post(
    "/deliveries/:id/retry",
    { schema: { params: idParams, response: { 202: deliveryResponse } } },
    async (request, reply) => {
      const found = await findForTenant(db, request.tenantId, request.params.id);
      if (!found) throw notFound("delivery");
      if (!found.endpointEnabled) {
        throw new HttpError(409, "endpoint_disabled", "Enable the endpoint before retrying");
      }

      const delivery = await resetForRetry(db, found.delivery.id);
      if (!delivery) {
        throw new HttpError(409, "not_retryable", "Only failed deliveries can be retried");
      }

      await queue.enqueue({ deliveryId: delivery.id });
      return reply.code(202).send(toResponse(delivery, []));
    },
  );
};
