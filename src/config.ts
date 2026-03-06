import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  DELIVERY_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  BACKOFF_BASE_MS: z.coerce.number().int().positive().default(5_000),
  BACKOFF_MAX_MS: z.coerce.number().int().positive().default(3_600_000),
  AUTO_DISABLE_AFTER: z.coerce.number().int().positive().default(20),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
