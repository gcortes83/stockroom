import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { GATEWAY_CONFIG, type GatewayConfig } from './config';
import { upstreamUrl, type Upstream } from './routes';

const UPSTREAMS: Upstream[] = ['catalog', 'orders', 'payments'];

@Controller('health')
export class HealthController {
  constructor(@Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig) {}

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<Record<string, unknown>> {
    const entries = await Promise.all(
      UPSTREAMS.map(async (name) => {
        try {
          const response = await fetch(`${upstreamUrl(this.config, name)}/health/ready`, { signal: AbortSignal.timeout(2000) });
          return [name, response.ok] as const;
        } catch {
          return [name, false] as const;
        }
      }),
    );
    const checks = Object.fromEntries(entries);
    const ready = entries.every(([, ok]) => ok);
    if (!ready) void reply.status(503);
    return { status: ready ? 'ok' : 'unavailable', checks };
  }
}
