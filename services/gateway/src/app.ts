import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import proxy from '@fastify/http-proxy';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildOpenApiDocument } from '@stockroom/contracts';
import { buildProblem, createHttpApp, sendProblem } from '@stockroom/platform';
import { AppModule } from './app.module';
import type { GatewayConfig } from './config';
import { PROXY_ROUTES, rateBucket, upstreamUrl } from './routes';

type UpstreamFailure = Error & { code?: string; statusCode?: number };

function upstreamError(upstream: string) {
  return (rawReply: unknown, { error }: { error: UpstreamFailure }) => {
    const reply = rawReply as FastifyReply;
    const request = reply.request;
    const timedOut = error.code === 'FST_REPLY_FROM_GATEWAY_TIMEOUT' || error.statusCode === 504;
    sendProblem(
      reply,
      buildProblem(
        timedOut ? 504 : 502,
        timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
        timedOut ? `The ${upstream} service did not respond in time` : `The ${upstream} service is unavailable`,
        request.url,
        String(request.id),
        { service: upstream },
      ),
    );
  };
}

export async function buildGateway(config: GatewayConfig): Promise<NestFastifyApplication> {
  return createHttpApp(AppModule.forRoot(config), {
    configure: async (instance) => {
      await instance.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
      await instance.register(cors, { origin: config.WEB_ORIGIN, exposedHeaders: ['etag', 'location', 'x-request-id', 'idempotent-replayed'] });
      await instance.register(rateLimit, {
        timeWindow: '1 minute',
        max: (request: FastifyRequest) => rateBucket(request.method, request.url, config.RATE_LIMIT_PER_MINUTE).max,
        keyGenerator: (request: FastifyRequest) => `${request.ip}:${rateBucket(request.method, request.url, config.RATE_LIMIT_PER_MINUTE).name}`,
        allowList: (request: FastifyRequest) => request.url.startsWith('/health'),
        errorResponseBuilder: (request, context) => ({
          ...buildProblem(429, 'RATE_LIMITED', `Too many requests, retry in ${context.after}`, request.url, String(request.id)),
          statusCode: 429,
        }),
      });
      await instance.register(swagger, { mode: 'static', specification: { document: buildOpenApiDocument() as never } });
      await instance.register(swaggerUi, {
        routePrefix: '/api/docs',
        staticCSP: false,
        uiConfig: { docExpansion: 'list', deepLinking: true, displayRequestDuration: true, tryItOutEnabled: true },
      });
      for (const route of PROXY_ROUTES) {
        await instance.register(proxy, {
          upstream: upstreamUrl(config, route.upstream),
          prefix: route.prefix,
          rewritePrefix: route.rewritePrefix,
          http: { requestOptions: { timeout: config.UPSTREAM_TIMEOUT_MS } },
          replyOptions: { onError: upstreamError(route.upstream) },
        });
      }
    },
  });
}
