import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { problemType } from '@stockroom/contracts';
import { DomainError } from '../errors';

const HTTP_CODES: Record<number, string> = {
  400: 'VALIDATION',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'FILE_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

export function titleFromCode(code: string): string {
  const words = code.toLowerCase().split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ProblemBody = Record<string, unknown> & { status: number; code: string };

export function buildProblem(
  status: number,
  code: string,
  detail: string,
  instance: string,
  correlationId: string,
  extensions: Record<string, unknown> = {},
): ProblemBody {
  return {
    type: problemType(code),
    title: titleFromCode(code),
    status,
    detail,
    instance,
    code,
    correlationId,
    ...extensions,
  };
}

export function sendProblem(reply: FastifyReply, problem: ProblemBody): void {
  void reply.status(problem.status).header('content-type', 'application/problem+json; charset=utf-8').send(problem);
}

export function problemFromError(error: unknown, request: FastifyRequest, logger: Logger): ProblemBody {
  const instance = request.url;
  const correlationId = String(request.id);
  if (error instanceof DomainError) {
    return buildProblem(error.status, error.code, error.message, instance, correlationId, error.extensions);
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const code = HTTP_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'HTTP_ERROR');
    return buildProblem(status, code, error.message, instance, correlationId);
  }
  const fastifyError = error as { statusCode?: number; code?: string; message?: string };
  if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode < 500) {
    const status = fastifyError.statusCode;
    const code =
      fastifyError.code === 'FST_REQ_FILE_TOO_LARGE' || fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
        ? 'FILE_TOO_LARGE'
        : (HTTP_CODES[status] ?? 'HTTP_ERROR');
    return buildProblem(status, code, fastifyError.message ?? 'Request error', instance, correlationId);
  }
  logger.error({ err: error, correlationId }, 'Unhandled error');
  return buildProblem(500, 'INTERNAL', 'An unexpected error occurred', instance, correlationId);
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    sendProblem(reply, problemFromError(exception, request, this.logger));
  }
}
