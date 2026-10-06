import type { IncomingMessage } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { type DynamicModule, Logger as NestLogger, type Type } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { ProblemFilter, problemFromError, sendProblem } from './problem.filter';
import { resolveRequestId } from './request-id';

export type HttpAppOptions = {
  bodyLimit?: number;
  configure?: (app: NestFastifyApplication) => Promise<void> | void;
};

export function createFastifyAdapter(bodyLimit = 64 * 1024): FastifyAdapter {
  return new FastifyAdapter({
    bodyLimit,
    trustProxy: true,
    genReqId: (request: IncomingMessage) => {
      const id = resolveRequestId(request.headers['x-request-id']);
      request.headers['x-request-id'] = id;
      return id;
    },
  });
}

export async function configureHttpApp(app: NestFastifyApplication, options: HttpAppOptions = {}): Promise<NestFastifyApplication> {
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  const fastify = app.getHttpAdapter().getInstance();
  const logger = new NestLogger('Http');
  fastify.addHook('onSend', async (request, reply, payload) => {
    void reply.header('x-request-id', request.id);
    return payload;
  });
  fastify.setErrorHandler((error, request, reply) => {
    sendProblem(reply, problemFromError(error, request, logger));
  });
  await options.configure?.(app);
  return app;
}

export async function createHttpApp(module: Type<unknown> | DynamicModule, options: HttpAppOptions = {}): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(module, createFastifyAdapter(options.bodyLimit), { bufferLogs: true });
  return configureHttpApp(app, options);
}

export async function listen(app: NestFastifyApplication, port: number): Promise<void> {
  await app.listen(port, '0.0.0.0');
  new NestLogger('Bootstrap').log(`Listening on port ${port}`);
}
