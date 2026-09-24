import type { ApiError } from '@inventur/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { DomainError } from '../errors.ts';

/** Sends domain errors and validation errors as `ApiError` responses. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | DomainError, request, reply) => {
    if (error instanceof DomainError) {
      const body: ApiError = { error: error.message, code: error.code };
      if (error.details !== undefined) body.details = error.details;
      return reply.code(error.statusCode).send(body);
    }
    if (error.validation) {
      const body: ApiError = { error: error.message, code: 'validation_failed' };
      return reply.code(400).send(body);
    }
    if (error.statusCode !== undefined && error.statusCode < 500) {
      // Client errors raised by Fastify itself, e.g. malformed JSON.
      const body: ApiError = { error: error.message, code: 'validation_failed' };
      return reply.code(error.statusCode).send(body);
    }
    request.log.error(error);
    const body: ApiError = { error: 'Internal server error', code: 'internal_error' };
    return reply.code(500).send(body);
  });
}
