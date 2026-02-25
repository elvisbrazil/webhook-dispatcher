import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import type { DeliveryQueue } from "../../queue/port.js";
import { publishEvent } from "./service.js";

const publishBody = z.object({
  type: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

const publishResponse = z.object({
  id: z.uuid(),
  type: z.string(),
  createdAt: z.string(),
  deliveries: z.number().int(),
});

export const eventRoutes: FastifyPluginAsyncZod<{ db: Database; queue: DeliveryQueue }> = async (
  app,
  { db, queue },
) => {
  app.post(
    "/events",
    { schema: { body: publishBody, response: { 200: publishResponse, 202: publishResponse } } },
    async (request, reply) => {
      const result = await publishEvent(db, queue, request.tenantId, request.body);
      return reply.code(result.created ? 202 : 200).send({
        id: result.event.id,
        type: result.event.type,
        createdAt: result.event.createdAt.toISOString(),
        deliveries: result.deliveries,
      });
    },
  );
};
