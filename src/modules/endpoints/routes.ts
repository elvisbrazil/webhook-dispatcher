import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { notFound } from "../../errors.js";
import {
  createEndpoint,
  findEndpoint,
  listEndpoints,
  setEndpointEnabled,
  type Endpoint,
} from "./repository.js";

const eventType = z
  .string()
  .min(1)
  .max(100)
  .regex(/^(\*|[a-zA-Z0-9_.-]+)$/, "event types use letters, digits, '.', '_', '-' or '*'");

const createBody = z.object({
  url: z.url({ protocol: /^https?$/ }),
  description: z.string().max(200).optional(),
  eventTypes: z.array(eventType).min(1).max(50),
});

const endpointResponse = z.object({
  id: z.uuid(),
  url: z.string(),
  description: z.string().nullable(),
  eventTypes: z.array(z.string()),
  enabled: z.boolean(),
  disabledReason: z.string().nullable(),
  createdAt: z.string(),
});

const idParams = z.object({ id: z.uuid() });

function toResponse(endpoint: Endpoint) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description,
    eventTypes: endpoint.eventTypes,
    enabled: endpoint.enabled,
    disabledReason: endpoint.disabledReason,
    createdAt: endpoint.createdAt.toISOString(),
  };
}

export const endpointRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.post(
    "/endpoints",
    {
      schema: {
        body: createBody,
        response: { 201: endpointResponse.extend({ secret: z.string() }) },
      },
    },
    async (request, reply) => {
      const endpoint = await createEndpoint(db, request.tenantId, request.body);
      return reply.code(201).send({ ...toResponse(endpoint), secret: endpoint.secret });
    },
  );

  app.get(
    "/endpoints",
    { schema: { response: { 200: z.object({ data: z.array(endpointResponse) }) } } },
    async (request) => {
      const rows = await listEndpoints(db, request.tenantId);
      return { data: rows.map(toResponse) };
    },
  );

  app.get(
    "/endpoints/:id",
    { schema: { params: idParams, response: { 200: endpointResponse } } },
    async (request) => {
      const endpoint = await findEndpoint(db, request.tenantId, request.params.id);
      if (!endpoint) throw notFound("endpoint");
      return toResponse(endpoint);
    },
  );

  for (const [action, enabled] of [
    ["disable", false],
    ["enable", true],
  ] as const) {
    app.post(
      `/endpoints/:id/${action}`,
      { schema: { params: idParams, response: { 200: endpointResponse } } },
      async (request) => {
        const endpoint = await setEndpointEnabled(db, request.tenantId, request.params.id, enabled);
        if (!endpoint) throw notFound("endpoint");
        return toResponse(endpoint);
      },
    );
  }
};
