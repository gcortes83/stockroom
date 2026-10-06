import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { newId } from '../ids';

const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function resolveRequestId(header: unknown): string {
  return typeof header === 'string' && VALID_REQUEST_ID.test(header) ? header : newId();
}

export const RequestId = createParamDecorator(
  (_: unknown, context: ExecutionContext): string => String(context.switchToHttp().getRequest<FastifyRequest>().id),
);
