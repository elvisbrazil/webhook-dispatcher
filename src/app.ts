import Fastify, { type FastifyServerOptions } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Database } from "./db/client.js";
import { tenantAuth } from "./plugins/auth.js";

export type AppOptions = {
  db: Database;
  logger?: FastifyServerOptions["logger"];
};

export async function buildApp({ db, logger = false }: AppOptions) {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(async (api) => {
    await api.register(tenantAuth, { db });
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
