import fp from "fastify-plugin";
import type { Database } from "../db/client.js";
import { findTenantByApiKey } from "../modules/tenants/repository.js";

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string;
  }
}

export const API_KEY_HEADER = "x-api-key";

export const tenantAuth = fp<{ db: Database }>(async (app, { db }) => {
  app.decorateRequest("tenantId", "");

  app.addHook("onRequest", async (request, reply) => {
    const apiKey = request.headers[API_KEY_HEADER];
    const tenant = typeof apiKey === "string" ? await findTenantByApiKey(db, apiKey) : undefined;
    if (!tenant) {
      return reply.code(401).send({ error: "unauthorized", message: "Missing or invalid API key" });
    }
    request.tenantId = tenant.id;
  });
});
