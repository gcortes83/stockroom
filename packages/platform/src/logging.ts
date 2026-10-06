import { LoggerModule } from 'nestjs-pino';
import type { DynamicModule } from '@nestjs/common';

export type LoggingOptions = { service: string; level: string; pretty: boolean };

export function loggingModule(options: LoggingOptions): DynamicModule {
  return LoggerModule.forRoot({
    pinoHttp: {
      level: options.level,
      base: { service: options.service },
      genReqId: (request) => String(request.headers['x-request-id'] ?? ''),
      customProps: (request) => ({ correlationId: request.headers['x-request-id'] }),
      autoLogging: { ignore: (request) => (request.url ?? '').startsWith('/health') },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', '*.cardNumber', '*.cvc'],
        censor: '[redacted]',
      },
      transport: options.pretty ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
    },
  });
}
