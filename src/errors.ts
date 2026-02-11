import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (resource: string) =>
  new HttpError(404, "not_found", `${resource} not found`);

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (hasZodFastifySchemaValidationErrors(error)) {
    return reply.code(400).send({
      error: "validation_error",
      message: "Request validation failed",
      issues: error.validation.map((issue) => ({
        path: issue.instancePath,
        message: issue.message,
      })),
    });
  }

  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }

  if (error.statusCode && error.statusCode < 500) {
    return reply.code(error.statusCode).send({ error: "bad_request", message: error.message });
  }

  request.log.error({ err: error }, "unhandled error");
  return reply.code(500).send({ error: "internal_error", message: "Internal server error" });
}
