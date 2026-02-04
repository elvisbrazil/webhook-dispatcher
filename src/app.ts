import Fastify, { type FastifyServerOptions } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

export type AppOptions = {
  logger?: FastifyServerOptions["logger"];
};

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
