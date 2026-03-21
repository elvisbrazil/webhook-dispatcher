import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyServerOptions } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Database } from "./db/client.js";
import { errorHandler } from "./errors.js";
import { deliveryRoutes } from "./modules/deliveries/routes.js";
import { endpointRoutes } from "./modules/endpoints/routes.js";
import { eventRoutes } from "./modules/events/routes.js";
import { API_KEY_HEADER, tenantAuth } from "./plugins/auth.js";
import type { DeliveryQueue } from "./queue/port.js";

export type AppOptions = {
  db: Database;
  queue: DeliveryQueue;
  logger?: FastifyServerOptions["logger"];
};

export async function buildApp({ db, queue, logger = false }: AppOptions) {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  await app.register(swagger, {
    openapi: {
      info: { title: "webhook-dispatcher", version: "0.1.0" },
      components: {
        securitySchemes: {
          apiKey: { type: "apiKey", in: "header", name: API_KEY_HEADER },
        },
      },
      security: [{ apiKey: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/health", { schema: { hide: true } }, async () => ({ status: "ok" }));

  await app.register(async (api) => {
    await api.register(tenantAuth, { db });
    await api.register(endpointRoutes, { db });
    await api.register(eventRoutes, { db, queue });
    await api.register(deliveryRoutes, { db, queue });
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
